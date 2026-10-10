import type {
  PullRequestRepository,
  PullRequestSummary,
  PullRequestComment,
  PullRequestThread,
  PullRequestDetail,
  PullRequestFile,
} from '@prokopai/sdk/types';
import type { PullRequestProviderPort } from '@/application/ports/pull-requests';
import { BadRequestError, ConflictError } from '@/application/http-errors';
import { array, githubApi, integer, object, required, str, type RunCli } from './cli';

const actor = (value: unknown) => {
  if (value === null) return { id: 'deleted', name: 'Deleted user' };
  const v = object(value);
  return { id: String(integer(v.id)), name: required(v.login) };
};
function summary(value: unknown): PullRequestSummary {
  const v = object(value);
  const head = object(v.head);
  const base = object(v.base);
  if (!['open', 'closed'].includes(str(v.state)) || typeof v.draft !== 'boolean')
    throw new BadRequestError('GitHub returned an invalid PR state.');
  return {
    number: integer(v.number),
    title: required(v.title),
    body: str(v.body),
    url: required(v.html_url),
    author: actor(v.user),
    state: v.merged_at || v.merged === true ? 'merged' : v.state === 'closed' ? 'closed' : 'open',
    draft: v.draft,
    sourceBranch: required(head.ref),
    targetBranch: required(base.ref),
    head: required(head.sha),
    base: required(base.sha),
    updatedAt: required(v.updated_at),
    requestedReviewerIds: array(v.requested_reviewers).map((r) => actor(r).id),
  };
}
function comment(value: unknown): PullRequestComment {
  const v = object(value);
  return {
    id: String(integer(v.id)),
    author: actor(v.user),
    body: str(v.body),
    createdAt: required(v.created_at),
  };
}
const PAGE = 30;
const repoPath = (owner: string, name: string) =>
  `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
/** REST path for a provider-reported `full_name`, the canonical name after renames or transfers. */
function canonicalPath(value: unknown): string {
  const parts = required(value).split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1])
    throw new BadRequestError('GitHub returned an invalid repository name.');
  return repoPath(parts[0], parts[1]);
}

export function createGitHubPullRequests(
  run: RunCli,
  cwd: string,
  repo: PullRequestRepository,
): PullRequestProviderPort {
  const api = githubApi(run, cwd);
  const base = repoPath(repo.owner, repo.name);
  // GitHub answers writes to a renamed or transferred repository with a 307 that gh does not
  // follow (reads get a followed 301), so writes target the canonical name from a read first.
  const writeBase = async () => canonicalPath(object(await api(base)).full_name);
  const raw = (number: number) => api(`${base}/pulls/${number}`).then(object);
  const graph = async (query: string, variables: Record<string, unknown>) => {
    const response = object(await api('graphql', 'POST', { query, variables }));
    if (response.errors)
      throw new BadRequestError(
        'GitHub could not complete the review request. Check permissions and refresh.',
      );
    return object(response.data);
  };
  const threads = async (number: number): Promise<{ threads: PullRequestThread[]; truncated: boolean }> => {
    const data = await graph(
      `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage} nodes{id path line diffSide isResolved isOutdated viewerCanResolve viewerCanUnresolve comments(first:100){pageInfo{hasNextPage} nodes{databaseId body createdAt author{login}}}}}}}}`,
      { owner: repo.owner, name: repo.name, number },
    );
    const connection = object(object(object(data.repository).pullRequest).reviewThreads);
    let truncated = object(connection.pageInfo).hasNextPage === true;
    const result = array(connection.nodes).map((value) => {
      const v = object(value);
      const comments = object(v.comments);
      truncated ||= object(comments.pageInfo).hasNextPage === true;
      return {
        id: required(v.id),
        path: required(v.path),
        ...(typeof v.line === 'number' ? { line: integer(v.line) } : {}),
        side: v.diffSide === 'LEFT' ? ('LEFT' as const) : ('RIGHT' as const),
        resolved: v.isResolved === true,
        outdated: v.isOutdated === true,
        canResolve: v.isResolved ? v.viewerCanUnresolve === true : v.viewerCanResolve === true,
        comments: array(comments.nodes).map((c) => {
          const x = object(c);
          const login = x.author ? required(object(x.author).login) : 'Deleted user';
          return {
            id: String(integer(x.databaseId)),
            body: str(x.body),
            author: { id: login, name: login },
            createdAt: required(x.createdAt),
          };
        }),
      };
    });
    return { threads: result, truncated };
  };
  const file = (value: unknown): PullRequestFile => {
    const v = object(value);
    return {
      path: required(v.filename),
      ...(v.previous_filename ? { oldPath: required(v.previous_filename) } : {}),
      status: required(v.status),
      additions: integer(v.additions),
      deletions: integer(v.deletions),
    };
  };
  const checked = async (number: number, head: string) => {
    const pr = await raw(number);
    if (required(object(pr.head).sha) !== head)
      throw new ConflictError('The PR changed. Refresh before continuing.');
    return pr;
  };
  return {
    async account() {
      const user = actor(await api('user'));
      return { id: user.id, name: user.name };
    },
    async list(state, page) {
      const values = array(
        await api(
          `${base}/pulls?state=${state === 'merged' ? 'closed' : state}&sort=updated&direction=desc&per_page=${PAGE}&page=${page}`,
        ),
      );
      const items = values.map(summary);
      return {
        items: state === 'merged' || state === 'closed' ? items.filter((p) => p.state === state) : items,
        nextPage: values.length === PAGE ? page + 1 : null,
      };
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
          warnings.push(`${label} unavailable. Refresh or open on GitHub.`);
          return fallback;
        }
      };
      const [comments, reviews, reviewThreads, checks, statuses, repository] = await Promise.all([
        optional(
          'Comments',
          async () => array(await api(`${base}/issues/${number}/comments?per_page=100`)).map(comment),
          [],
        ),
        optional('Reviews', async () => array(await api(`${base}/pulls/${number}/reviews?per_page=100`)), []),
        optional('Inline conversations', () => threads(number), { threads: [], truncated: false }),
        optional(
          'Checks',
          async () =>
            array(object(await api(`${base}/commits/${result.head}/check-runs?per_page=100`)).check_runs),
          [],
        ),
        optional(
          'Commit statuses',
          async () => array(object(await api(`${base}/commits/${result.head}/status?per_page=100`)).statuses),
          [],
        ),
        optional('Merge methods', async () => object(await api(base)), {} as Record<string, unknown>),
      ]);
      if (
        comments.length === 100 ||
        reviews.length === 100 ||
        reviewThreads.truncated ||
        checks.length === 100 ||
        statuses.length === 100
      )
        warnings.push('Some activity may be omitted. Open on GitHub for the full history.');
      const reviewers = new Map<string, PullRequestDetail['reviewers'][number]>();
      for (const value of reviews) {
        const review = object(value);
        if (review.state === 'PENDING') continue;
        const user = actor(review.user);
        reviewers.set(user.id, { ...user, vote: required(review.state) });
        if (str(review.body)) comments.push(comment({ ...review, created_at: review.submitted_at }));
      }
      for (const value of array(pr.requested_reviewers)) {
        const user = actor(value);
        reviewers.set(user.id, { ...user, vote: 'Review requested' });
      }
      comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return {
        ...result,
        autoMerge: pr.auto_merge != null,
        reviewers: [...reviewers.values()],
        comments,
        threads: reviewThreads.threads,
        warnings,
        checks: [
          ...checks.map((value) => {
            const v = object(value);
            return {
              name: required(v.name),
              state: str(v.conclusion) || required(v.status),
              url: str(v.html_url),
            };
          }),
          ...statuses.map((value) => {
            const v = object(value);
            return { name: required(v.context), state: required(v.state), url: str(v.target_url) };
          }),
        ],
        mergeability:
          pr.mergeable === true ? 'mergeable' : pr.mergeable === false ? 'conflicting' : 'unknown',
        mergeMethods: [
          ...(repository.allow_merge_commit === true ? ['merge' as const] : []),
          ...(repository.allow_squash_merge === true ? ['squash' as const] : []),
          ...(repository.allow_rebase_merge === true ? ['rebase' as const] : []),
        ],
      };
    },
    async files(number, head, page) {
      await checked(number, head);
      const values = array(await api(`${base}/pulls/${number}/files?per_page=${PAGE}&page=${page}`));
      await checked(number, head);
      return {
        files: values.map(file),
        nextPage: values.length === PAGE && page < 100 ? page + 1 : null,
        truncated: values.length === PAGE && page === 100,
        head,
      };
    },
    async patch(number, head, path) {
      await checked(number, head);
      // GitHub only exposes patches through the paginated changed-file list.
      for (let page = 1; page <= 30; page++) {
        const values = array(await api(`${base}/pulls/${number}/files?per_page=100&page=${page}`));
        const found = values.map(object).find((v) => v.filename === path);
        if (found) {
          await checked(number, head);
          if (!str(found.patch))
            return {
              patch: '',
              unavailable:
                'GitHub did not provide a text patch for this file. It may be binary, unchanged after rename, or too large.',
            };
          const oldPath = str(found.previous_filename) || path;
          const old = found.status === 'added' ? '/dev/null' : JSON.stringify(`a/${oldPath}`);
          const next = found.status === 'removed' ? '/dev/null' : JSON.stringify(`b/${path}`);
          return {
            patch: `diff --git ${JSON.stringify(`a/${oldPath}`)} ${JSON.stringify(`b/${path}`)}\n--- ${old}\n+++ ${next}\n${str(found.patch)}\n`,
          };
        }
        if (values.length < 100) break;
      }
      throw new BadRequestError('File is not in the available PR diff.');
    },
    async create(input) {
      return summary(
        await api(`${await writeBase()}/pulls`, 'POST', {
          title: input.title,
          body: input.body,
          head: input.sourceBranch,
          base: input.targetBranch,
          draft: input.draft,
        }),
      );
    },
    async action(number, input) {
      const pr = await checked(number, input.expectedHead);
      const target = canonicalPath(object(object(pr.base).repo).full_name);
      switch (input.action) {
        case 'edit':
          await api(`${target}/pulls/${number}`, 'PATCH', { title: input.title, body: input.body });
          break;
        case 'close':
        case 'reopen':
          await api(`${target}/pulls/${number}`, 'PATCH', {
            state: input.action === 'close' ? 'closed' : 'open',
          });
          break;
        case 'ready':
        case 'draft': {
          const mutation =
            input.action === 'ready' ? 'markPullRequestReadyForReview' : 'convertPullRequestToDraft';
          await graph(`mutation($id:ID!){${mutation}(input:{pullRequestId:$id}){pullRequest{id}}}`, {
            id: required(pr.node_id),
          });
          break;
        }
        case 'merge': {
          if (input.method === 'rebase-merge')
            throw new BadRequestError('GitHub does not support this merge method.');
          const result = object(
            await api(`${target}/pulls/${number}/merge`, 'PUT', {
              sha: input.expectedHead,
              merge_method: input.method,
            }),
          );
          if (result.merged !== true)
            throw new ConflictError('GitHub did not merge the PR. Refresh its checks and merge status.');
          break;
        }
        case 'enable-auto-merge': {
          if (input.method === 'rebase-merge')
            throw new BadRequestError('GitHub does not support this merge method.');
          await graph(
            'mutation($id:ID!,$method:PullRequestMergeMethod!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:$method}){pullRequest{id}}}',
            { id: required(pr.node_id), method: input.method.toUpperCase() },
          );
          break;
        }
        case 'disable-auto-merge':
          await graph(
            'mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){pullRequest{id}}}',
            { id: required(pr.node_id) },
          );
          break;
        case 'review': {
          const events = { comment: 'COMMENT', approve: 'APPROVE', 'request-changes': 'REQUEST_CHANGES' };
          if (!(input.verdict in events)) throw new BadRequestError('Unsupported GitHub review verdict.');
          await api(`${target}/pulls/${number}/reviews`, 'POST', {
            commit_id: input.expectedHead,
            body: input.body,
            event: events[input.verdict as keyof typeof events],
          });
          break;
        }
        case 'comment':
          if (input.position)
            await api(`${target}/pulls/${number}/comments`, 'POST', {
              body: input.body,
              commit_id: input.expectedHead,
              path: input.position.path,
              line: input.position.line,
              side: input.position.side,
            });
          else await api(`${target}/issues/${number}/comments`, 'POST', { body: input.body });
          break;
        case 'reviewer':
          await api(`${target}/pulls/${number}/requested_reviewers`, input.remove ? 'DELETE' : 'POST', {
            reviewers: [input.reviewer],
          });
          break;
        case 'reply':
        case 'resolve': {
          const thread = (await threads(number)).threads.find((t) => t.id === input.threadId);
          if (!thread) throw new BadRequestError('Conversation is not part of this pull request.');
          if (input.action === 'reply') {
            if (!thread.comments[0]) throw new BadRequestError('Conversation has no comment to reply to.');
            await api(`${target}/pulls/${number}/comments/${thread.comments[0].id}/replies`, 'POST', {
              body: input.body,
            });
          } else {
            const mutation = input.resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
            await graph(`mutation($id:ID!){${mutation}(input:{threadId:$id}){thread{id}}}`, {
              id: thread.id,
            });
          }
          break;
        }
      }
    },
  };
}
