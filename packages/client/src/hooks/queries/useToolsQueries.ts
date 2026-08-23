import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';
import type { ToolDisplayCatalog } from '@/lib/toolSummaries';

export function useToolsQuery(sdkClient: ProkopaiClient | null) {
  return useQuery({
    queryKey: queryKeys.tools.all,
    queryFn: () => sdkClient!.http.tools.list(),
    enabled: !!sdkClient,
  });
}

/**
 * Map of tool name → display declarations, for collapsed-row summaries.
 * Shares the tools query cache; safe to call from every ToolCall row.
 */
export function useToolDisplayCatalog(sdkClient: ProkopaiClient | null): ToolDisplayCatalog {
  const { data } = useQuery({
    queryKey: queryKeys.tools.all,
    queryFn: () => sdkClient!.http.tools.list(),
    enabled: !!sdkClient,
    staleTime: 5 * 60 * 1000,
  });

  if (!data?.tools) return {};

  const catalog: ToolDisplayCatalog = {};
  for (const tool of data.tools) {
    if (tool.display?.summary) {
      catalog[tool.name] = { display: { summary: tool.display.summary } };
    }
  }
  return catalog;
}

export function useToolEnvVarsQuery(sdkClient: ProkopaiClient | null) {
  return useQuery({
    queryKey: queryKeys.tools.envVars,
    queryFn: () => sdkClient!.http.tools.listEnvVars(),
    enabled: !!sdkClient,
  });
}

export function useToolSetEnvVar(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      sdkClient!.http.tools.setEnvVar(key, { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tools.envVars });
    },
  });
}

export function useToolClearEnvVar(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (key: string) =>
      sdkClient!.http.tools.clearEnvVar(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tools.envVars });
    },
  });
}
