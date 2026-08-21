import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';
import { useServerDataStore } from '@/stores/serverDataStore';

export function usePreconfigsQuery(sdkClient: ProkopaiClient | null) {
  return useQuery({
    queryKey: queryKeys.config.preconfigs,
    queryFn: () => sdkClient!.http.preconfigs.list(),
    enabled: !!sdkClient,
  });
}

async function syncPreconfigsToStoreAndCache(sdkClient: ProkopaiClient, queryClient: import('@tanstack/react-query').QueryClient) {
  const data = await sdkClient.http.preconfigs.list();
  useServerDataStore.getState().updatePreconfigs(data.preconfigs);
  queryClient.setQueryData(queryKeys.config.preconfigs, data);
}

export function useCreatePreconfig(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdkClient!.http.preconfigs.create(body),
    onSuccess: () => {
      if (sdkClient) return syncPreconfigsToStoreAndCache(sdkClient, queryClient);
    },
  });
}

export function useUpdatePreconfig(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      sdkClient!.http.preconfigs.update(id, body),
    onSuccess: () => {
      if (sdkClient) syncPreconfigsToStoreAndCache(sdkClient, queryClient);
    },
  });
}

export function useDeletePreconfig(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      sdkClient!.http.preconfigs.delete(id),
    onSuccess: () => {
      if (sdkClient) syncPreconfigsToStoreAndCache(sdkClient, queryClient);
    },
  });
}
