import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useSetProviderCredential, useClearProviderCredential } from '@/hooks/queries/useProvidersQueries';
import { queryKeys } from '@/lib/queryKeys';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { ExperimentalPanel } from '@/components/modals/configuration/ExperimentalPanel';
import { useUIStore } from '@/stores/uiStore';

afterEach(cleanup);
function mount(enabled: boolean, configured: boolean, fail = false) {
  const setContextSelection = vi.fn(async (value: boolean) => {
    if (fail) throw new Error('failure');
    return { enabled: value, configured };
  });
  const client = { http: { providers: { getContextSelection: async () => ({ enabled, configured }), setContextSelection } } } as unknown as ProkopaiClient;
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  render(<QueryClientProvider client={cache}><ExperimentalPanel sdkClient={client} /></QueryClientProvider>);
  return setContextSelection;
}

test('credential mutations update experimental readiness without waiting for refetch', async () => {
  const cache = new QueryClient();
  cache.setQueryData(queryKeys.config.contextSelection, { enabled: false, configured: false });
  const client = { http: { providers: {
    setCredential: async () => ({ provider: 'typesafe', configured: true }),
    clearCredential: async () => ({ provider: 'typesafe', configured: false }),
  } } } as unknown as ProkopaiClient;
  const hook = renderHook(() => ({ set: useSetProviderCredential(client), clear: useClearProviderCredential(client) }), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={cache}>{children}</QueryClientProvider>,
  });
  await act(async () => { await hook.result.current.set.mutateAsync({ provider: 'typesafe', body: { apiKey: 'fake' } }); });
  expect(cache.getQueryData(queryKeys.config.contextSelection)).toEqual({ enabled: false, configured: true });
  await act(async () => { await hook.result.current.clear.mutateAsync('typesafe'); });
  expect(cache.getQueryData(queryKeys.config.contextSelection)).toEqual({ enabled: false, configured: false });
  hook.unmount();
  cache.clear();
});

test('missing key prevents enabling and links to provider settings', async () => {
  const save = mount(false, false);
  await screen.findByText('Configure a TypeSafe API key before enabling selection.');
  expect(screen.getByRole('switch')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Open LLM Providers' }));
  expect(useUIStore.getState().configurationSection).toBe('providers');
  expect(save).not.toHaveBeenCalled();
});

test('configured key allows enabling with disclosure and persisted response updates the switch', async () => {
  const save = mount(false, true);
  await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());
  expect(screen.getByText(/Enabling sends task text/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(save).toHaveBeenCalledWith(true));
  await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());
});

test('removing key still permits turning a previously enabled feature off', async () => {
  const save = mount(true, false);
  await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(save).toHaveBeenCalledWith(false));
  await waitFor(() => expect(screen.getByRole('switch')).toBeDisabled());
});

test('failed writes do not pretend the feature was enabled', async () => {
  mount(false, true, true);
  await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());
  fireEvent.click(screen.getByRole('switch'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  expect(screen.getByRole('switch')).not.toBeChecked();
});
