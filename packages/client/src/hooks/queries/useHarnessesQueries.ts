import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProkopaiClient, SessionHarness, HarnessStatus, HarnessUsageLimits } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';

export function useHarnessesQuery(sdkClient: ProkopaiClient | null) {
  return useQuery({
    queryKey: queryKeys.harnesses.all,
    queryFn: (): Promise<{ harnesses: HarnessStatus[] }> => sdkClient!.http.sessions.harnesses(),
    enabled: !!sdkClient,
    staleTime: 60_000,
  });
}

export function useSetHarnessEnabled(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ harness, enabled }: { harness: SessionHarness; enabled: boolean }) =>
      sdkClient!.http.sessions.setHarnessEnabled(harness, enabled),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.harnesses.all, data);
      // Catalog queries are gated on enablement; refetch so a re-enabled
      // harness repopulates its model tab immediately.
      void queryClient.invalidateQueries({ queryKey: ['claude-catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['codex-catalog'] });
    },
  });
}

/** Enabled helper that treats an absent field (older server) as enabled. */
export function isHarnessEnabled(status: HarnessStatus | undefined): boolean {
  return status === undefined || status.enabled !== false;
}

/** Open cards poll slower than provider HTTP probes, since a read may spawn the CLI. */
const HARNESS_USAGE_POLL_MS = 5 * 60_000;

/** Plan usage for one native harness. Each uncached server read starts the CLI, so the panel only fetches while open. */
export function useHarnessUsageQuery(sdkClient: ProkopaiClient | null, harness: HarnessUsageLimits['harness'], enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.harnesses.usage(harness),
    queryFn: async (): Promise<HarnessUsageLimits> => (await sdkClient!.http.sessions.harnessUsage(harness)).usage,
    enabled: !!sdkClient && enabled,
    staleTime: 30_000,
    refetchInterval: HARNESS_USAGE_POLL_MS,
    refetchOnWindowFocus: true,
  });
}
