import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';

export function useWorkspaceTagsQuery(
  sdkClient: ProkopaiClient | null,
  workspaceId: string | null,
) {
  return useQuery({
    queryKey: queryKeys.sessions.tags(workspaceId ?? ''),
    queryFn: () => sdkClient!.http.sessions.listTags(workspaceId!),
    enabled: !!sdkClient && !!workspaceId,
  });
}

export function useInvalidateWorkspaceTags() {
  const queryClient = useQueryClient();
  return (workspaceId: string) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.sessions.tags(workspaceId) });
  };
}
