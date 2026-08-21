import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';

export function useMcpStatusQuery(
  sdkClient: ProkopaiClient | null,
  workspaceId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.mcp.status(workspaceId ?? ''),
    queryFn: () => sdkClient!.http.mcp.getStatus(workspaceId!),
    enabled: !!sdkClient && !!workspaceId,
  });
}

export function useMcpConnect(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, name }: { workspaceId: string; name: string }) =>
      sdkClient!.http.mcp.connect(workspaceId, name),
    onSuccess: (_data, { workspaceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.status(workspaceId) });
    },
  });
}

export function useMcpDisconnect(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, name }: { workspaceId: string; name: string }) =>
      sdkClient!.http.mcp.disconnect(workspaceId, name),
    onSuccess: (_data, { workspaceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.status(workspaceId) });
    },
  });
}

export function useMcpStartAuth(sdkClient: ProkopaiClient | null) {
  return useMutation({
    mutationFn: ({ workspaceId, name }: { workspaceId: string; name: string }) =>
      sdkClient!.http.mcp.startAuth(workspaceId, name),
  });
}
