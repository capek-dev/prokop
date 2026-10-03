import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProkopaiClient, ProviderAccountSummary, UsageProvider } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';
import type { OAuthRedirectStrategy } from '@prokopai/sdk';

export function useCodexAccountUsageQuery(sdkClient: ProkopaiClient | null, account: ProviderAccountSummary) {
  return useQuery({
    queryKey: queryKeys.config.providers.codexAccountUsage(account.id, account.connectionId, account.reauthRequired),
    queryFn: async ({ signal }) => (await sdkClient!.http.providers.codexAccountUsage(account.id, { signal })).usage,
    enabled: !!sdkClient && !account.reauthRequired,
    staleTime: 30_000,
    retry: false,
  });
}

export function useProviderUsageQuery(sdkClient: ProkopaiClient | null, provider: UsageProvider) {
  return useQuery({
    queryKey: queryKeys.config.providers.usage(provider),
    queryFn: async ({ signal }) => (await sdkClient!.http.providers.usage(provider, { signal })).usage,
    enabled: !!sdkClient,
    staleTime: 30_000,
    retry: false,
  });
}

export function useProvidersQuery(sdkClient: ProkopaiClient | null) {
  return useQuery({
    queryKey: queryKeys.config.providers.all,
    queryFn: () => sdkClient!.http.providers.list(),
    enabled: !!sdkClient,
  });
}

export function useProviderCredentialsQuery(sdkClient: ProkopaiClient | null) {
  return useQuery({
    queryKey: queryKeys.config.providers.credentials,
    queryFn: () => sdkClient!.http.providers.listCredentials(),
    enabled: !!sdkClient,
  });
}

export function useConnectProvider(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, redirectStrategy }: { providerId: string; redirectStrategy?: OAuthRedirectStrategy }) =>
      sdkClient!.http.providers.connect(providerId, { redirectStrategy }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config.providers.all });
    },
  });
}

export function useDisconnectProvider(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) =>
      sdkClient!.http.providers.disconnect(providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config.providers.all });
    },
  });
}

export function useProviderAccountMutation(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, accountId, action }: {
      providerId: string;
      accountId: string;
      action: 'activate' | 'remove';
    }) => action === 'activate'
      ? sdkClient!.http.providers.activateAccount(providerId, accountId)
      : sdkClient!.http.providers.removeAccount(providerId, accountId),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.config.providers.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.config.models }),
    ]),
  });
}

export function useCompleteOAuth(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { flowId: string; code: string; state: string; redirectUri: string }) =>
      sdkClient!.http.providers.completeOAuth(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config.providers.all });
    },
  });
}

export function useSetProviderCredential(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, body }: {
      provider: string;
      body: { apiKey: string };
    }) => sdkClient!.http.providers.setCredential(provider, body),
    onSuccess: async (_data, { provider }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.config.providers.usage(provider) });
      await queryClient.resetQueries({ queryKey: queryKeys.config.providers.usage(provider) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.config.providers.credentials });
    },
  });
}

export function useClearProviderCredential(sdkClient: ProkopaiClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) =>
      sdkClient!.http.providers.clearCredential(provider),
    onSuccess: async (_data, provider) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.config.providers.usage(provider) });
      await queryClient.resetQueries({ queryKey: queryKeys.config.providers.usage(provider) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.config.providers.credentials });
    },
  });
}
