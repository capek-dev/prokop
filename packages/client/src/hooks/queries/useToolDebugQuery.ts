import { useQuery } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';

export function useToolDebugQuery(
  sdkClient: ProkopaiClient | null,
  sessionId: string,
  partId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.sessions.toolDebug(sessionId, partId),
    queryFn: () => sdkClient!.http.sessions.getToolDebug(sessionId, partId),
    enabled: !!sdkClient && enabled,
    staleTime: Infinity,
  });
}
