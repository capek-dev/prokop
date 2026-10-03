import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useClearProviderCredential, useProviderUsageQuery, useSetProviderCredential } from '@/hooks/queries/useProvidersQueries';
import { queryKeys } from '@/lib/queryKeys';

test('credential replacement and removal discard cached usage and refetch active cards', async () => {
  let remaining = '10';
  const providers = {
    usage: vi.fn(async () => ({ usage: { provider: 'deepseek', checkedAt: '', plan: null, windows: [], balances: [{ currency: 'USD', remaining }] } })),
    setCredential: vi.fn(async () => { remaining = '20'; return { provider: 'deepseek', configured: true }; }),
    clearCredential: vi.fn(async () => { remaining = '0'; return { provider: 'deepseek', configured: false }; }),
  };
  const client = { http: { providers } } as unknown as ProkopaiClient;
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => ({
    usage: useProviderUsageQuery(client, 'deepseek'),
    set: useSetProviderCredential(client),
    clear: useClearProviderCredential(client),
  }), { wrapper });
  await waitFor(() => expect(result.current.usage.data?.balances[0]?.remaining).toBe('10'));
  await act(async () => { await result.current.set.mutateAsync({ provider: 'deepseek', body: { apiKey: 'fake' } }); });
  await waitFor(() => expect(result.current.usage.data?.balances[0]?.remaining).toBe('20'));
  await act(async () => { await result.current.clear.mutateAsync('deepseek'); });
  await waitFor(() => expect(result.current.usage.data?.balances[0]?.remaining).toBe('0'));
  expect(providers.usage).toHaveBeenCalledTimes(3);
  expect(cache.getQueryData(queryKeys.config.providers.usage('deepseek'))).toMatchObject({ balances: [{ remaining: '0' }] });
});
