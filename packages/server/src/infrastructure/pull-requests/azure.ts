import { createTwoFilesPatch } from 'diff';
import type {
  PullRequestRepository,
  PullRequestSummary,
  PullRequestThread,
  PullRequestFile,
} from '@prokopai/sdk/types';
import type { PullRequestProviderPort } from '@/application/ports/pull-requests';
import { BadRequestError, ConflictError } from '@/application/http-errors';
import { array, azureApi, integer, object, required, str, type RunCli } from './cli';

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
const PAGE = 30;

export function createAzurePullRequests(
  run: RunCli,
  cwd: string,
  repo: PullRequestRepository,
): PullRequestProviderPort {
  const api = azureApi(run, cwd, repo);
  const raw = async (number: number) => object(await api('pullRequests', { pullRequestId: number }));
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
      requestedReviewerIds: array(v.reviewers)
        .map(object)
        .filter((r) => r.vote === 0)
        .map((r) => required(r.id)),
    };
  };
  const checked = async (number: number, head: string) => {
    const pr = await raw(number);
    if (summary(pr).head !== head) throw new ConflictError('The PR changed. Refresh before continuing.');
    return pr;
  };
  const iteration = async (number: number) => {
    const entries = values(await api('pullRequestIterations', { pullRequestId: number })).map(object);
    const latest = entries.sort((a, b) => integer(b.id) - integer(a.id))[0];
    if (!latest) throw new BadRequestError('Azure returned no PR iteration.');
    return latest;
  };
  const changes = async (number: number, id: number, skip: number, count = PAGE) => {
    const result = object(
      await api(
        'pullRequestIterationChanges',
        { pullRequestId: number, iterationId: id },
        { $compareTo: 0, $top: count, $skip: skip },
      ),
    );
    const files = array(result.changeEntries).map((value) => {
      const v = object(value);
      const item = object(v.item);
      const oldPath = str(v.sourceServerItem) || str(v.originalPath);
      return {
        path: required(item.path),
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
    values(await api('pullRequestThreads', { pullRequestId: number }))
      .filter((value) => object(value).isDeleted !== true)
      .map((value) => {
        const v = object(value);
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
          comments: array(v.comments)
            .filter((c) => !object(c).isDeleted)
            .map((c) => {
              const x = object(c);
              return {
                id: String(integer(x.id)),
                author: actor(x.author),
                body: str(x.content),
                createdAt: required(x.publishedDate),
              };
            }),
        };
      });
  const account = async () => {
    // DevOps authenticates independently of az account (PATs and cross-tenant organizations).
    const connection = object(await api('connectionData', {}, {}, 'GET', undefined, 'location'));
    const user = object(connection.authenticatedUser);
    return {
      id: required(user.id),
      name: str(user.providerDisplayName) || str(user.customDisplayName) || required(user.id),
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
        await api(
          'pullRequests',
          {},
          { 'searchCriteria.status': statuses[state], $top: PAGE, $skip: (page - 1) * PAGE },
        ),
      );
      return { items: result.map(summary), nextPage: result.length === PAGE ? page + 1 : null };
    },
    async summary(number) {
      return summary(await raw(number));
    },
    async detail(number) {
      const pr = await raw(number);
      const result = summary(pr);
      const warnings: string[] = [];
      const optional = async <T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await read();
        } catch {
          warnings.push(`${label} unavailable. Refresh or open on Azure DevOps.`);
          return fallback;
        }
      };
      const project = required(object(object(pr.repository).project).id);
      const [allThreads, statuses, policies, latest] = await Promise.all([
        optional('Conversations', () => threads(number), []),
        optional(
          'Statuses',
          async () => values(await api('pullRequestStatuses', { pullRequestId: number })),
          [],
        ),
        optional(
          'Policies',
          async () =>
            values(
              await api(
                'evaluations',
                {},
                { artifactId: `vstfs:///CodeReview/CodeReviewId/${project}/${number}` },
                'GET',
                undefined,
                'policy',
              ),
            ),
          [],
        ),
        optional('Review iteration', () => iteration(number), null),
      ]);
      return {
        ...result,
        autoMerge: pr.autoCompleteSetBy != null,
        comments: [],
        threads: allThreads,
        reviewers: array(pr.reviewers).map((value) => {
          const v = object(value);
          return { ...actor(v), vote: votes[String(v.vote)] ?? 'Unknown vote' };
        }),
        warnings,
        checks: [
          ...statuses.map((value) => {
            const v = object(value);
            return {
              name: required(object(v.context).name),
              state: required(v.state),
              url: str(v.targetUrl),
            };
          }),
          ...policies.map((value) => {
            const v = object(value);
            return {
              name: required(object(object(v.configuration).type).displayName),
              state: required(v.status),
            };
          }),
        ],
        mergeability:
          pr.mergeStatus === 'succeeded'
            ? 'mergeable'
            : pr.mergeStatus === 'conflicts'
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
          await api(
            'items',
            {},
            {
              path: filePath,
              'versionDescriptor.versionType': 'commit',
              'versionDescriptor.version': commit,
              includeContent: 'true',
              includeContentMetadata: 'true',
              $format: 'json',
            },
          ),
        );
        if (
          object(item.contentMetadata).isBinary === true ||
          typeof item.content !== 'string' ||
          item.content.length > 250_000
        )
          return null;
        return item.content;
      };
      const source = required(object(latest.sourceRefCommit).commitId);
      const baseCommit = required(object(latest.commonRefCommit).commitId);
      const oldPath = found.oldPath ?? path;
      const oldText = /add/i.test(found.status) ? '' : await read(oldPath, baseCommit);
      const newText = /delete/i.test(found.status) ? '' : await read(path, source);
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
        await api('pullRequests', {}, {}, 'POST', {
          title: input.title,
          description: input.body,
          sourceRefName: `refs/heads/${input.sourceBranch}`,
          targetRefName: `refs/heads/${input.targetBranch}`,
          isDraft: input.draft,
        }),
      );
    },
    async action(number, input) {
      await checked(number, input.expectedHead);
      const route = { pullRequestId: number };
      const writeComment = (body: string) =>
        api('pullRequestThreads', route, {}, 'POST', {
          comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
          status: 1,
        });
      switch (input.action) {
        case 'edit':
          await api('pullRequests', route, {}, 'PATCH', { title: input.title, description: input.body });
          break;
        case 'close':
        case 'reopen':
          await api('pullRequests', route, {}, 'PATCH', {
            status: input.action === 'close' ? 'abandoned' : 'active',
          });
          break;
        case 'ready':
        case 'draft':
          await api('pullRequests', route, {}, 'PATCH', { isDraft: input.action === 'draft' });
          break;
        case 'merge': {
          const strategies = {
            merge: 'noFastForward',
            squash: 'squash',
            rebase: 'rebase',
            'rebase-merge': 'rebaseMerge',
          };
          const result = object(
            await api('pullRequests', route, {}, 'PATCH', {
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
        case 'enable-auto-merge': {
          const strategies = {
            merge: 'noFastForward',
            squash: 'squash',
            rebase: 'rebase',
            'rebase-merge': 'rebaseMerge',
          };
          await api('pullRequests', route, {}, 'PATCH', {
            autoCompleteSetBy: { id: input.accountId },
            completionOptions: {
              mergeStrategy: strategies[input.method],
              deleteSourceBranch: false,
              bypassPolicy: false,
            },
          });
          break;
        }
        case 'disable-auto-merge':
          await api('pullRequests', route, {}, 'PATCH', { autoCompleteSetBy: null });
          break;
        case 'review': {
          // Separate calls: if the vote fails after a comment, explicitly report partial completion.
          if (input.body) await writeComment(input.body);
          if (input.verdict !== 'comment') {
            const value = {
              approve: 10,
              'approve-with-suggestions': 5,
              'request-changes': -10,
              wait: -5,
              reset: 0,
            }[input.verdict];
            try {
              await api('pullRequestReviewers', { ...route, reviewerId: input.accountId }, {}, 'PUT', {
                id: input.accountId,
                vote: value,
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
          await api('pullRequestThreads', route, {}, 'POST', {
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
          });
          break;
        }
        case 'reviewer': {
          // CLI resolves an email address or identity ID using the selected organization.
          await run({
            command: 'az',
            cwd,
            args: [
              'repos',
              'pr',
              'reviewer',
              input.remove ? 'remove' : 'add',
              '--id',
              String(number),
              '--reviewers',
              input.reviewer,
              '--organization',
              `https://dev.azure.com/${repo.owner}`,
              '--detect',
              'false',
              '--only-show-errors',
              '--output',
              'json',
            ],
          });
          break;
        }
        case 'reply':
        case 'resolve': {
          const thread = (await threads(number)).find((t) => t.id === input.threadId);
          if (!thread) throw new BadRequestError('Conversation is not part of this pull request.');
          const threadRoute = { ...route, threadId: input.threadId };
          if (input.action === 'reply')
            await api('pullRequestThreadComments', threadRoute, {}, 'POST', {
              content: input.body,
              parentCommentId: 0,
              commentType: 1,
            });
          else await api('pullRequestThreads', threadRoute, {}, 'PATCH', { status: input.resolved ? 2 : 1 });
          break;
        }
      }
    },
  };
}
