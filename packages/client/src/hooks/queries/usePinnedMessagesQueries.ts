import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProkopaiClient, PinnedMessage } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';

export function usePinnedMessagesQuery(
  sdkClient: ProkopaiClient | null,
  workspaceId: string | null | undefined,
) {
  return useQuery({
    queryKey: workspaceId
      ? queryKeys.pinnedMessages.byWorkspace(workspaceId)
      : ['pinnedMessages', 'workspace', 'none'],
    enabled: !!sdkClient && !!workspaceId,
    queryFn: async (): Promise<PinnedMessage[]> => {
      if (!sdkClient || !workspaceId) throw new Error('Not connected');
      const response = await sdkClient.http.workspaces.listPinnedMessages(workspaceId);
      return response.pinnedMessages;
    },
  });
}

export function usePinMessageMutation(
  sdkClient: ProkopaiClient | null,
  workspaceId: string | null | undefined,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { sessionId: string; messageId: string }) => {
      if (!sdkClient || !workspaceId) throw new Error('Not connected');
      return sdkClient.http.workspaces.pinMessage(workspaceId, data);
    },
    onSuccess: () => {
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.pinnedMessages.byWorkspace(workspaceId) });
      }
    },
  });
}

export function useUnpinMessageMutation(
  sdkClient: ProkopaiClient | null,
  workspaceId: string | null | undefined,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId }: { messageId: string }) => {
      if (!sdkClient || !workspaceId) throw new Error('Not connected');
      return sdkClient.http.workspaces.unpinMessage(workspaceId, messageId);
    },
    onSuccess: () => {
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.pinnedMessages.byWorkspace(workspaceId) });
      }
    },
  });
}
