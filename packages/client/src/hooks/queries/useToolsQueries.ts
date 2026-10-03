import { useQuery } from '@tanstack/react-query';
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
