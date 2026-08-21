import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';

export function useToolsQuery(sdkClient: ProkopaiClient | null) {
  return useQuery({
    queryKey: queryKeys.tools.all,
    queryFn: () => sdkClient!.http.tools.list(),
    enabled: !!sdkClient,
  });
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
