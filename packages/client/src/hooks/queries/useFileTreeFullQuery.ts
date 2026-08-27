import { useQuery } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Full recursive path list for one workspace root, consumed by the
 * Pierre-based file tree (`FileTreePierre`). One request replaces the
 * per-directory lazy browse chain that `useFlatFileTree` performs.
 */
export function useFileTreeFullQuery(
  sdkClient: ProkopaiClient | null,
  workspaceId: string,
  root?: string,
) {
  return useQuery({
    queryKey: queryKeys.files.tree(workspaceId, root),
    queryFn: async () => {
      if (!sdkClient) throw new Error('SDK client unavailable');
      return sdkClient.http.files.tree(workspaceId, { root });
    },
    enabled: Boolean(sdkClient && workspaceId),
    staleTime: 10_000,
  });
}
