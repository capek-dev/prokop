import { createTwoFilesPatch } from 'diff';
import type {
  PullRequestRepository,
  PullRequestSummary,
  PullRequestThread,
  PullRequestFile,
  PullRequestMergeMethod,
} from '@prokopai/sdk/types';
import type { PullRequestProviderPort } from '@/application/ports/pull-requests';
import { BadRequestError, ConflictError } from '@/application/http-errors';
import { array, integer, object, required, str } from './cli';
import type { AzureApi } from './azure-rest';

const actor = (value: unknown) => {
  const v = object(value);
  return { id: required(v.id), name: str(v.displayName) || required(v.uniqueName) };
};
const values = (value: unknown) => array(object(value).value);
const votes: Record<string, string> = {
  '10': 'Approved',
  '5': 'Approved with suggestions',
  '0': 'No vote',
  '-5': 'Waiting for author',
  '-10': 'Rejected',
};
const strategies: Record<PullRequestMergeMethod, string> = {
  merge: 'noFastForward',
  squash: 'squash',
  rebase: 'rebase',
  'rebase-merge': 'rebaseMerge',
};
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 30;

export function createAzurePullRequests(api: AzureApi, repo: PullRequestRepository): PullRequestProviderPort {
  const pr = (number: number, rest = '') => `pullrequests/${number}${rest}`;
  const raw = async (number: number) => object(await api({ path: pr(number) }));
  const summary = (value: unknown): PullRequestSummary => {
    const v = object(value);
    if (!['active', 'abandoned', 'completed'].includes(str(v.status)))
      throw new BadRequestError('Azure returned an invalid PR state.');
    return {
      number: integer(v.pullRequestId),
      title: required(v.title),
      body: str(v.description),
      url: `${repo.url}/pullrequest/${integer(v.pullRequestId)}`,
      author: actor(v.createdBy),
      state: v.status === 'completed' ? 'merged' : v.status === 'abandoned' ? 'closed' : 'open',
      draft: v.isDraft === true,
      sourceBranch: required(v.sourceRefName).replace(/^refs\/heads\//, ''),
      targetBranch: required(v.targetRefName).replace(/^refs\/heads\//, ''),
      head: required(object(v.lastMergeSourceCommit).commitId),
      base: required(object(v.lastMergeTargetCommit).commitId),
      updatedAt: str(v.closedDate) || required(v.creationDate),
      requestedReviewerIds: array(v.reviewers ?? [])
        .map(object)
        .filter((r) => r.vote === 0)
        .map((r) => required(r.id)),
    };
  };
  const checked = async (number: number, head: string) => {
    const result = await raw(number);
    if (summary(result).head !== head) throw new ConflictError('The PR changed. Refresh before continuing.');
    return result;
  };
  const iteration = async (number: number) => {
    const entries = values(await api({ path: pr(number, '/iterations') })).map(object);
    const latest = entries.sort((a, b) => integer(b.id) - integer(a.id))[0];
    if (!latest) throw new BadRequestError('Azure returned no PR iteration.');
    return latest;
  };
  const changes = async (number: number, id: number, skip: number, count = PAGE) => {
    const result = object(
      await api({
        path: pr(number, `/iterations/${id}/changes`),
        query: { $compareTo: 0, $top: count, $skip: skip },
      }),
    );
    const files = array(result.changeEntries)
      .map(object)
      .filter((v) => object(v.item).isFolder !== true)
      .map((v) => {
        const oldPath = str(v.sourceServerItem) || str(v.originalPath);
        return {
          path: required(object(v.item).path),
          ...(oldPath ? { oldPath } : {}),
          status: required(v.changeType),
          additions: null,
          deletions: null,
          changeTrackingId: integer(v.changeTrackingId),
        } satisfies PullRequestFile;
      });
    const nextSkip = typeof result.nextSkip === 'number' && result.nextSkip > skip ? result.nextSkip : null;
    return { files, nextSkip };
  };
  const threads = async (number: number): Promise<PullRequestThread[]> =>
    values(await api({ path: pr(number, '/threads') }))
      .map(object)
      .filter((v) => v.isDeleted !== true)
      .map((v) => ({
        v,
        // Votes, pushes and policy events arrive as system comments; they are not conversations.
        comments: array(v.comments ?? [])
          .map(object)
          .filter((c) => c.isDeleted !== true && c.commentType !== 'system'),
      }))
      .filter(({ comments }) => comments.length > 0)
      .map(({ v, comments }) => {
        const context = v.threadContext ? object(v.threadContext) : null;
        const right = context?.rightFileStart ? object(context.rightFileStart) : null;
        const left = context?.leftFileStart ? object(context.leftFileStart) : null;
        return {
          id: String(integer(v.id)),
          ...(context
            ? {
                path: required(context.filePath),
                ...(right || left
                  ? {
                      line: integer((right ?? left)?.line),
                      side: right ? ('RIGHT' as const) : ('LEFT' as const),
                    }
                  : {}),
              }
            : {}),
          resolved: ['fixed', 'closed', 'wontFix', 'byDesign', 2, 3, 4, 5].includes(
            v.status as string | number,
          ),
          outdated: false,
          canResolve: true,
          comments: comments.map((x) => ({
            id: String(integer(x.id)),
            author: actor(x.author),
            body: str(x.content),
            createdAt: required(x.publishedDate),
          })),
        };
      });
  const account = async () => {
    // Organization connection data names the identity Azure DevOps actually authenticated.
    const connection = object(await api({ path: 'connectionData', scope: 'organization', version: '7.1-preview' }));
    const user = object(connection.authenticatedUser);
    return {
      id: required(user.id),
      name: str(user.providerDisplayName) || str(user.customDisplayName) || required(user.id),
    };
  };
  const identity = async (reviewer: string) => {
    if (GUID.test(reviewer)) return reviewer;
    const matches = values(
      await api({
        path: 'identities',
        scope: 'identities',
        query: { searchFilter: 'General', filterValue: reviewer, queryMembership: 'None' },
      }),
    ).map(object);
    if (matches.length !== 1)
      throw new BadRequestError(
        matches.length
          ? `"${reviewer}" matches several Azure DevOps users. Use the full e-mail address.`
          : `No Azure DevOps user matches "${reviewer}". Use their e-mail address.`,
      );
    return required(matches[0].id);
  };
  // Azure omits enum fields that hold their default value (status state "notSet").
  const statusCheck = (status: unknown) => {
    const v = object(status);
    const context = object(v.context);
    return {
      name: [str(context.genre), required(context.name)].filter(Boolean).join('/'),
      state: str(v.state) || 'notSet',
      url: str(v.targetUrl),
    };
  };
  const policyCheck = (policy: unknown) => {
    const v = object(policy);
    const configuration = object(v.configuration);
    // Build policies share a type name; their configured display name tells them apart.
    const name =
      str(object(configuration.settings ?? {}).displayName) || required(object(configuration.type).displayName);
    const buildId = object(v.context ?? {}).buildId;
    return {
      name: configuration.isBlocking === false ? `${name} (optional)` : name,
      state: str(v.status) || 'queued',
      ...(typeof buildId === 'number'
        ? {
            url: `https://dev.azure.com/${repo.owner}/${encodeURIComponent(repo.project!)}/_build/results?buildId=${buildId}`,
          }
        : {}),
    };
  };
  return {
    account,
    async list(state, page) {
      const statuses: Record<string, string> = {
        open: 'active',
        closed: 'abandoned',
        merged: 'completed',
        all: 'all',
      };
      const result = values(
        await api({
          path: 'pullrequests',
          query: { 'searchCriteria.status': statuses[state], $top: PAGE, $skip: (page - 1) * PAGE },
        }),
      );
      return { items: result.map(summary), nextPage: result.length === PAGE ? page + 1 : null };
    },
    async summary(number) {
      return summary(await raw(number));
    },
    async detail(number) {
      const value = await raw(number);
      const result = summary(value);
      const warnings: string[] = [];
      const optional = async <T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await read();
        } catch {
          warnings.push(`${label} unavailable. Refresh or open on Azure DevOps.`);
          return fallback;
        }
      };
      const project = required(object(object(value.repository).project).id);
      const [allThreads, statuses, policies, latest] = await Promise.all([
        optional('Conversations', () => threads(number), []),
        optional(
          'Statuses',
          async () => values(await api({ path: pr(number, '/statuses') })).map(statusCheck),
          [],
        ),
        optional(
          'Policies',
          async () =>
            values(
              await api({
                path: 'policy/evaluations',
                scope: 'project',
                query: { artifactId: `vstfs:///CodeReview/CodeReviewId/${project}/${number}` },
                version: '7.1-preview.1',
              }),
            ).map(policyCheck),
          [],
        ),
        optional('Review iteration', () => iteration(number), null),
      ]);
      return {
        ...result,
        autoMerge: value.autoCompleteSetBy != null,
        comments: [],
        threads: allThreads,
        reviewers: array(value.reviewers ?? []).map((reviewer) => {
          const v = object(reviewer);
          return { ...actor(v), vote: votes[String(v.vote)] ?? 'Unknown vote' };
        }),
        warnings,
        checks: [...statuses, ...policies],
        mergeability:
          value.mergeStatus === 'succeeded'
            ? 'mergeable'
            : value.mergeStatus === 'conflicts'
              ? 'conflicting'
              : 'unknown',
        mergeMethods: ['merge', 'squash', 'rebase', 'rebase-merge'],
        ...(latest ? { iteration: integer(latest.id) } : {}),
      };
    },
    async files(number, head, page) {
      await checked(number, head);
      const latest = await iteration(number);
      const id = integer(latest.id);
      const result = await changes(number, id, (page - 1) * PAGE);
      await checked(number, head);
      return {
        files: result.files,
        nextPage: result.nextSkip === null ? null : result.nextSkip / PAGE + 1,
        head,
        iteration: id,
      };
    },
    async patch(number, head, path) {
      await checked(number, head);
      const latest = await iteration(number);
      let found: PullRequestFile | undefined;
      for (let skip = 0; skip < 3000; ) {
        const result = await changes(number, integer(latest.id), skip, 100);
        found = result.files.find((f) => f.path === path);
        if (found || result.nextSkip === null) break;
        skip = result.nextSkip;
      }
      if (!found) throw new BadRequestError('File is not in the available PR diff.');
      const read = async (filePath: string, commit: string) => {
        const item = object(
          await api({
            path: 'items',
            query: {
              path: filePath,
              'versionDescriptor.versionType': 'commit',
              'versionDescriptor.version': commit,
              includeContent: 'true',
              includeContentMetadata: 'true',
              $format: 'json',
            },
          }),
        );
        if (
          object(item.contentMetadata ?? {}).isBinary === true ||
          typeof item.content !== 'string' ||
          item.content.length > 250_000
        )
          return null;
        return item.content;
      };
      const source = required(object(latest.sourceRefCommit).commitId);
      const baseCommit = required(object(latest.commonRefCommit).commitId);
      const oldPath = found.oldPath ?? path;
      const [oldText, newText] = await Promise.all([
        /add/i.test(found.status) ? '' : read(oldPath, baseCommit),
        /delete/i.test(found.status) ? '' : read(path, source),
      ]);
      await checked(number, head);
      if (oldText === null || newText === null)
        return { patch: '', unavailable: 'Binary or large file. Open on Azure DevOps to view it.' };
      const patch = createTwoFilesPatch(
        /add/i.test(found.status) ? '/dev/null' : `a/${oldPath.replace(/^\//, '')}`,
        /delete/i.test(found.status) ? '/dev/null' : `b/${path.replace(/^\//, '')}`,
        oldText,
        newText,
        '',
        '',
        { context: 4, timeout: 1000 },
      );
      return patch === undefined
        ? { patch: '', unavailable: 'This diff exceeds the processing limit.' }
        : { patch };
    },
    async create(input) {
      if (input.sourceBranch.includes(':'))
        throw new BadRequestError('Choose a branch in the selected Azure repository.');
      return summary(
        await api({
          path: 'pullrequests',
          method: 'POST',
          body: {
            title: input.title,
            description: input.body,
            sourceRefName: `refs/heads/${input.sourceBranch}`,
            targetRefName: `refs/heads/${input.targetBranch}`,
            isDraft: input.draft,
          },
        }),
      );
    },
    async action(number, input) {
      await checked(number, input.expectedHead);
      const update = (body: unknown) => api({ path: pr(number), method: 'PATCH', body });
      const writeComment = (body: string) =>
        api({
          path: pr(number, '/threads'),
          method: 'POST',
          body: { comments: [{ parentCommentId: 0, content: body, commentType: 1 }], status: 1 },
        });
      switch (input.action) {
        case 'edit':
          await update({ title: input.title, description: input.body });
          break;
        case 'close':
        case 'reopen':
          await update({ status: input.action === 'close' ? 'abandoned' : 'active' });
          break;
        case 'ready':
        case 'draft':
          await update({ isDraft: input.action === 'draft' });
          break;
        case 'merge': {
          const result = object(
            await update({
              status: 'completed',
              lastMergeSourceCommit: { commitId: input.expectedHead },
              completionOptions: {
                mergeStrategy: strategies[input.method],
                deleteSourceBranch: false,
                bypassPolicy: false,
              },
            }),
          );
          if (
            !['completed', 'active'].includes(str(result.status)) ||
            ['conflicts', 'failure', 'rejectedByPolicy'].includes(str(result.mergeStatus))
          )
            throw new ConflictError('Azure did not complete the PR. Refresh its policy and merge status.');
          break;
        }
        case 'enable-auto-merge':
          await update({
            autoCompleteSetBy: { id: input.accountId },
            completionOptions: {
              mergeStrategy: strategies[input.method],
              deleteSourceBranch: false,
              bypassPolicy: false,
            },
          });
          break;
        case 'disable-auto-merge':
          // Azure clears automatic completion when the setter is the empty identity.
          await update({ autoCompleteSetBy: { id: '00000000-0000-0000-0000-000000000000' } });
          break;
        case 'review': {
          // Separate calls: if the vote fails after a comment, explicitly report partial completion.
          if (input.body) await writeComment(input.body);
          if (input.verdict !== 'comment') {
            const vote = {
              approve: 10,
              'approve-with-suggestions': 5,
              'request-changes': -10,
              wait: -5,
              reset: 0,
            }[input.verdict];
            try {
              await api({
                path: pr(number, `/reviewers/${input.accountId}`),
                method: 'PUT',
                body: { id: input.accountId, vote },
              });
            } catch (error: unknown) {
              if (input.body)
                throw new BadRequestError(
                  'Your comment was posted, but the vote failed. Refresh and retry only the vote.',
                );
              throw error;
            }
          }
          break;
        }
        case 'comment': {
          if (!input.position) {
            await writeComment(input.body);
            break;
          }
          const pos = input.position;
          const latest = await iteration(number);
          if (pos.iteration !== integer(latest.id) || !pos.changeTrackingId)
            throw new ConflictError('The file review position changed. Reload Files before commenting.');
          const side = pos.side === 'LEFT' ? 'left' : 'right';
          // Equal iteration IDs anchor the left side to the common commit, as in our cumulative diff.
          await api({
            path: pr(number, '/threads'),
            method: 'POST',
            body: {
              comments: [{ parentCommentId: 0, content: input.body, commentType: 1 }],
              status: 1,
              threadContext: {
                filePath: pos.path,
                [`${side}FileStart`]: { line: pos.line, offset: 1 },
                [`${side}FileEnd`]: { line: pos.line, offset: 1 },
              },
              pullRequestThreadContext: {
                changeTrackingId: pos.changeTrackingId,
                iterationContext: {
                  firstComparingIteration: pos.iteration,
                  secondComparingIteration: pos.iteration,
                },
              },
            },
          });
          break;
        }
        case 'reviewer': {
          const id = await identity(input.reviewer);
          await api(
            input.remove
              ? { path: pr(number, `/reviewers/${id}`), method: 'DELETE' }
              : { path: pr(number, `/reviewers/${id}`), method: 'PUT', body: { id, vote: 0 } },
          );
          break;
        }
        case 'reply':
        case 'resolve': {
          const thread = (await threads(number)).find((t) => t.id === input.threadId);
          if (!thread) throw new BadRequestError('Conversation is not part of this pull request.');
          const path = pr(number, `/threads/${thread.id}`);
          if (input.action === 'reply')
            await api({
              path: `${path}/comments`,
              method: 'POST',
              body: { content: input.body, parentCommentId: 0, commentType: 1 },
            });
          else await api({ path, method: 'PATCH', body: { status: input.resolved ? 2 : 1 } });
          break;
        }
      }
    },
  };
}
