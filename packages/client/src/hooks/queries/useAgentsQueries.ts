import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';
import { useServerDataStore } from '@/stores/serverDataStore';

export function useAgentsQuery(sdkClient: ProkopaiClient | null) {
  return useQuery({
    queryKey: queryKeys.config.agents,
    queryFn: () => sdkClient!.http.agents.list(),
    enabled: !!sdkClient,
  });
}

async function syncAgentResourcesToStoreAndCache(
  sdkClient: ProkopaiClient,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  const [agentsData, workspacesData] = await Promise.all([
    sdkClient.http.agents.list(),
    sdkClient.http.workspaces.list(),
  ]);
  useServerDataStore.getState().updateAgents(agentsData.agents);
  useServerDataStore.getState().setWorkspaces(workspacesData.workspaces);
  queryClient.setQueryData(queryKeys.config.agents, agentsData);
}

export function usePromoteAgent(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      sdkClient!.http.agents.promote(id),
    onSuccess: async () => {
      if (sdkClient) await syncAgentResourcesToStoreAndCache(sdkClient, queryClient);
    },
  });
}

export function useDemoteAgent(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sdkClient!.http.agents.delete(id),
    onSuccess: async () => {
      if (sdkClient) await syncAgentResourcesToStoreAndCache(sdkClient, queryClient);
    },
  });
}
