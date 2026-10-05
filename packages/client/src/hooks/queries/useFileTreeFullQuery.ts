import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FileTreeResponse, ProkopaiClient } from '@prokopai/sdk';
import { newerFileTree } from '@/lib/fileTreePaths';
import { queryKeys } from '@/lib/queryKeys';
import { retainFileTree } from '@/lib/rootFeedSubscriptions';

/**
 * Full recursive path list for one workspace root, consumed by the
 * Pierre-based file tree (`FileTreePierre`). One request replaces the
 * per-directory lazy browse chain that `useFlatFileTree` performs. While
 * mounted, the server pushes added and removed paths (`handleFileTree`).
 */
export function useFileTreeFullQuery(
  sdkClient: ProkopaiClient | null,
  workspaceId: string,
  root?: string,
) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.files.tree(workspaceId, root);

  useEffect(() => {
    if (!sdkClient || !workspaceId) return;
    return retainFileTree(sdkClient, workspaceId, root);
  }, [sdkClient, workspaceId, root]);

  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      if (!sdkClient) throw new Error('SDK client unavailable');
      return newerFileTree(
        queryClient.getQueryData<FileTreeResponse>(queryKey),
        await sdkClient.http.files.tree(workspaceId, { root, signal }),
      );
    },
    enabled: Boolean(sdkClient && workspaceId),
    // The feed keeps the cache current; a remount reuses it and gets the subscribe snapshot.
    staleTime: Infinity,
  });
}
