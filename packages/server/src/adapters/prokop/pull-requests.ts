import { resolve } from 'node:path';
import type { FilesApplicationPort } from '@/application/ports/files';
import type { PullRequestsPort } from '@/application/ports/pull-requests';
import { BadRequestError, NotFoundError } from '@/application/http-errors';

export function createProkopPullRequestsPort(
  files: FilesApplicationPort,
  changed: PullRequestsPort['changed'],
  providers: Pick<PullRequestsPort, 'repositories' | 'provider'>,
): PullRequestsPort {
  return {
    resolveRoot(workspaceId, query) {
      const workspace = files.getWorkspace(workspaceId);
      if (!workspace) throw new NotFoundError('Workspace not found.');
      const { root } = files.resolveRoot(workspace, query);
      if (query !== undefined && (!query || resolve(root) !== resolve(files.expandPathFor(query))))
        throw new BadRequestError('Selected checkout is unavailable.');
      return root;
    },
    ...providers,
    changed,
  };
}
