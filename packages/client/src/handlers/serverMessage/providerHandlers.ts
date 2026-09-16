import type { SessionHandlersContext } from './types';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';

export function handleProviderStatus(
  msg: { type: 'provider.status'; provider: string; connected: boolean; authorizationUrl?: string; error?: string; reauthRequired?: boolean },
  ctx: SessionHandlersContext,
): void {
  const { provider, connected, authorizationUrl, error, reauthRequired } = msg;
  const { setProviderStatuses } = ctx;

  setProviderStatuses(prev => {
    const existing = prev.find(s => s.provider === provider);
    if (existing) {
      return prev.map(s => s.provider === provider
        ? { ...s, connected, authorizationUrl, error, reauthRequired }
        : s
      );
    }
    return [...prev, { provider, connected, authorizationUrl, error, reauthRequired }];
  });
  queryClient.invalidateQueries({ queryKey: queryKeys.config.providers.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.config.providers.credentials });
  queryClient.invalidateQueries({ queryKey: queryKeys.config.models });
}

export function handleProviderConnected(
  msg: { type: 'provider.connected'; provider: string; connected: boolean; connectedAt?: string; accountId?: string },
  ctx: SessionHandlersContext,
): void {
  const { provider, connected, connectedAt, accountId } = msg;
  const { setProviderStatuses } = ctx;

  setProviderStatuses(prev =>
    prev.map(s => s.provider === provider
      ? { ...s, connected, connectedAt, accountId, error: undefined, reauthRequired: undefined }
      : s
    )
  );
  queryClient.invalidateQueries({ queryKey: queryKeys.config.providers.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.config.providers.credentials });
  queryClient.invalidateQueries({ queryKey: queryKeys.config.models });
}

export const providerHandlers = {
  'provider.status': handleProviderStatus,
  'provider.connected': handleProviderConnected,
} as const;
