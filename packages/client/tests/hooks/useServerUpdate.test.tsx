import type { ReactNode } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { ServerClientProvider, type ServerClientValue } from '@/contexts/ServerClientContext';
import { useServerUpdate } from '@/hooks/useServerUpdate';
import { fetchLatestServerVersion } from '@/utils/githubVersion';

vi.mock('sonner', () => ({ toast: vi.fn() }));
vi.mock('@/utils/githubVersion', () => ({ fetchLatestServerVersion: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(fetchLatestServerVersion).mockResolvedValue('1.15.0');
});

function setup(version: unknown = '1.14.0', connected = true) {
  const get = vi.fn().mockResolvedValue({ version });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let value: ServerClientValue = {
    sdkClient: { httpClient: { get } } as unknown as ProkopaiClient,
    serverUrl: `https://${crypto.randomUUID()}.example.com`, apiToken: null, connected,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ServerClientProvider value={value}>{children}</ServerClientProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => useServerUpdate(), { wrapper });
  return { ...hook, get, queryClient, switchServer: (next: Partial<ServerClientValue>) => { value = { ...value, ...next }; } };
}

describe('useServerUpdate', () => {
  it('notifies once and retains the indicator after repeated checks', async () => {
    const hook = setup();
    await waitFor(() => expect(hook.result.current).toBe('1.15.0'));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Prokop v1.15.0 is available', expect.objectContaining({ description: expect.stringContaining('prokop update') }));
    await act(() => hook.queryClient.invalidateQueries({ queryKey: ['server-update'] }));
    expect(toast).toHaveBeenCalledTimes(1);
    hook.get.mockResolvedValue({ version: '1.15.0' });
    await act(() => hook.queryClient.invalidateQueries({ queryKey: ['server-update'] }));
    await waitFor(() => expect(hook.result.current).toBeNull());
    hook.queryClient.clear();
  });

  it.each(['1.15.0', '2.0.0', '0.0.0-dev', undefined, 123])('does not advertise an update for current version %s', async (version) => {
    const hook = setup(version === undefined ? null : version);
    await waitFor(() => expect(hook.queryClient.isFetching()).toBe(0));
    expect(hook.result.current).toBeNull();
    expect(toast).not.toHaveBeenCalled();
    hook.queryClient.clear();
  });

  it('honors a notification already shown in this browser tab', async () => {
    const hook = setup('1.14.0', false);
    const serverUrl = 'https://already-notified.example.com';
    sessionStorage.setItem(`prokop-update:${serverUrl}:1.15.0`, '1');
    hook.switchServer({ serverUrl, connected: true });
    hook.rerender();
    await waitFor(() => expect(hook.result.current).toBe('1.15.0'));
    expect(toast).not.toHaveBeenCalled();
    hook.queryClient.clear();
  });

  it('keeps failures from the server info endpoint quiet', async () => {
    const hook = setup('1.14.0', false);
    hook.get.mockRejectedValue(new Error('offline'));
    hook.switchServer({ connected: true });
    hook.rerender();
    await waitFor(() => expect(hook.queryClient.getQueryCache().getAll()[0].state.status).toBe('error'));
    expect(hook.result.current).toBeNull();
    expect(toast).not.toHaveBeenCalled();
    hook.queryClient.clear();
  });

  it('does not check while disconnected', () => {
    const hook = setup('1.14.0', false);
    expect(hook.get).not.toHaveBeenCalled();
    expect(fetchLatestServerVersion).not.toHaveBeenCalled();
    hook.queryClient.clear();
  });

  it('does not leak a previous server result across a switch', async () => {
    const hook = setup();
    await waitFor(() => expect(hook.result.current).toBe('1.15.0'));
    hook.switchServer({ serverUrl: 'https://other.example.com', connected: false });
    hook.rerender();
    expect(hook.result.current).toBeNull();
    hook.queryClient.clear();
  });

  it('silently handles failed checks', async () => {
    vi.mocked(fetchLatestServerVersion).mockResolvedValue(null);
    const hook = setup();
    await waitFor(() => expect(hook.queryClient.isFetching()).toBe(0));
    expect(hook.result.current).toBeNull();
    expect(toast).not.toHaveBeenCalled();
    hook.queryClient.clear();
  });
});
