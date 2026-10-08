import type {
  PullRequestScope,
  PullRequestCreate,
  PullRequestMutation,
  PullRequestConnection,
} from '@prokopai/sdk/types';
import type { PullRequestsPort } from '@/application/ports/pull-requests';
import { BadRequestError, ConflictError } from '@/application/http-errors';

export function createPullRequestsApplication(port: PullRequestsPort) {
  const pending = new Set<string>();
  const target = async (workspaceId: string, scope: PullRequestScope) => {
    const root = port.resolveRoot(workspaceId, scope.root);
    const { repositories } = await port.repositories(root);
    const repository = repositories.find((r) => r.remote === scope.remote && r.key === scope.repositoryKey);
    if (!repository)
      throw new ConflictError('The selected remote changed or is unsupported. Rescan repositories.');
    return port.provider(root, repository);
  };
  const mutation = async <T>(
    workspaceId: string,
    scope: PullRequestScope,
    run: () => Promise<T>,
  ): Promise<T> => {
    const key = `${workspaceId}\0${scope.repositoryKey}`;
    if (pending.has(key)) throw new ConflictError('Another PR operation is in progress for this repository.');
    pending.add(key);
    try {
      return await run();
    } finally {
      pending.delete(key);
      // A command can fail after a remote write. Every outcome invalidates readers.
      try {
        port.changed(workspaceId, scope.repositoryKey);
      } catch {
        /* Reconnect refreshes readers. */
      }
    }
  };
  return {
    async discover(workspaceId: string, rootQuery?: string) {
      const root = port.resolveRoot(workspaceId, rootQuery);
      const { repositories, branch } = await port.repositories(root);
      const connections: PullRequestConnection[] = [];
      // Bound CLI fan-out when a workspace has many remotes.
      for (const repository of repositories) {
        try {
          const account = await port.provider(root, repository).account();
          connections.push({
            repository,
            status: 'connected',
            accountId: account.id,
            accountName: account.name,
          });
        } catch (error: unknown) {
          connections.push({
            repository,
            status: 'unavailable',
            message:
              error instanceof BadRequestError
                ? error.message
                : 'Could not connect. Check CLI installation and sign-in on the Prokop server.',
          });
        }
      }
      return { connections, branch };
    },
    async list(workspaceId: string, scope: PullRequestScope, state: string, page: number) {
      const provider = await target(workspaceId, scope);
      const account = await provider.account();
      const result = await provider.list(state, page);
      if ((await provider.account()).id !== account.id)
        throw new ConflictError('The CLI account changed. Rescan before continuing.');
      return { ...result, accountId: account.id };
    },
    async detail(workspaceId: string, scope: PullRequestScope, number: number) {
      const provider = await target(workspaceId, scope);
      const account = await provider.account();
      const result = await provider.detail(number);
      if ((await provider.account()).id !== account.id)
        throw new ConflictError('The CLI account changed. Rescan before continuing.');
      return { ...result, accountId: account.id };
    },
    async files(workspaceId: string, scope: PullRequestScope, number: number, head: string, page: number) {
      return (await target(workspaceId, scope)).files(number, head, page);
    },
    async patch(workspaceId: string, scope: PullRequestScope, number: number, head: string, path: string) {
      return (await target(workspaceId, scope)).patch(number, head, path);
    },
    create(workspaceId: string, scope: PullRequestScope, input: PullRequestCreate) {
      return mutation(workspaceId, scope, async () => {
        const provider = await target(workspaceId, scope);
        if ((await provider.account()).id !== input.accountId)
          throw new ConflictError('The CLI account changed. Rescan before creating a PR.');
        if (input.sourceBranch === input.targetBranch)
          throw new BadRequestError('Choose different source and target branches.');
        return provider.create(input);
      });
    },
    action(workspaceId: string, scope: PullRequestScope, number: number, input: PullRequestMutation) {
      return mutation(workspaceId, scope, async () => {
        const provider = await target(workspaceId, scope);
        if ((await provider.account()).id !== input.accountId)
          throw new ConflictError('The CLI account changed. Refresh before taking this action.');
        await provider.action(number, input);
        return { ok: true as const };
      });
    },
  };
}
export type PullRequestsApplication = ReturnType<typeof createPullRequestsApplication>;
