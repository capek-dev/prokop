import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProkopaiClient, SessionHarness, HarnessStatus } from '@prokopai/sdk';
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
