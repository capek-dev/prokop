import type { FileTreeResponse, GitStatusResponse, ProkopaiClient } from '@prokopai/sdk';
import { queryClient } from '@/components/providers/QueryProvider';
import { newerGitStatus } from '@/handlers/serverMessage/gitHandlers';
import { newerFileTree } from '@/lib/fileTreePaths';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Manual refresh. Plain refetches of a watched root return the server
 * feed's cached result, which misses changes no trigger reported (terminal
 * commands, external editors), so these ask the server to recompute. Other
 * subscribers get the change as a push; this client keeps the newer of the
 * response and its own push.
 */

export async function refreshGitStatus(client: ProkopaiClient, workspaceId: string, root: string | undefined): Promise<void> {
  const fresh = await client.http.files.gitStatus(workspaceId, { root, refresh: true });
  queryClient.setQueryData<GitStatusResponse>(
    queryKeys.files.gitStatus(workspaceId, root),
    (current) => newerGitStatus(current, fresh),
  );
}

export async function refreshFileTree(client: ProkopaiClient, workspaceId: string, root: string | undefined): Promise<void> {
  const fresh = await client.http.files.tree(workspaceId, { root, refresh: true });
  queryClient.setQueryData<FileTreeResponse>(
    queryKeys.files.tree(workspaceId, root),
    (current) => newerFileTree(current, fresh),
  );
}
