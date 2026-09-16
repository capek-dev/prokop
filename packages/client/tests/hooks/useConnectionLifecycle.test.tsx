import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { HttpClient } from '@prokopai/sdk';
import { useConnectionLifecycle } from '@/hooks/useConnectionLifecycle';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { queryClient } from '@/components/providers/QueryProvider';

vi.mock('@/config/client-identity', () => ({
  resolveClientDescriptor: async () => ({ clientId: 'test-client', clientType: 'web' }),
}));
vi.mock('@/hooks/subscribeToServerEvents', () => ({ subscribeToServerEvents: vi.fn() }));
vi.mock('@/lib/refreshWorkspaceActivity', () => ({ refreshWorkspaceActivity: vi.fn().mockResolvedValue(undefined) }));

class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sent: string[] = [];
  constructor() { FakeSocket.instances.push(this); }
  close(): void { this.readyState = 3; }
  send(message: string): void { this.sent.push(message); }
  open(): void { this.readyState = 1; this.onopen?.(); }
}
const latest = () => FakeSocket.instances.at(-1)!;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
function mount() {
  return renderHook(() => useConnectionLifecycle({
    apiToken: 'fake',
    serverUrl: 'http://test',
    currentSessionIdRef: { current: null },
    handlerContextRef: { current: null },
    handleLogout: vi.fn(),
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  FakeSocket.instances = [];
  useConnectionStore.getState().resetConnection();
  useSessionBoardStore.setState({ openSessionIds: [], focusedSessionId: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  useConnectionStore.getState().resetConnection();
  useSessionBoardStore.setState({ openSessionIds: [], focusedSessionId: null });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('connection lifecycle', () => {
  test('shutdown reconnects immediately and restores subscriptions without replaying mutations', async () => {
    vi.spyOn(HttpClient, 'verifyToken').mockResolvedValue(true);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    useSessionBoardStore.setState({ openSessionIds: ['session-1'], focusedSessionId: 'session-1' });
    const hook = mount();
    await flush();
    act(() => latest().open());
    expect(useConnectionStore.getState().connected).toBe(true);
    act(() => latest().onclose?.({ code: 1001, reason: 'Server shutting down', wasClean: true } as CloseEvent));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await flush();
    expect(FakeSocket.instances).toHaveLength(2);
    act(() => latest().open());
    const messages = latest().sent.map(value => JSON.parse(value));
    expect(messages.map(message => message.type)).toEqual(['client.register', 'session.resume']);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenLastCalledWith();
    expect(useConnectionStore.getState().connected).toBe(true);
    hook.unmount();
  });

  test('manual retry aborts preflight and ignores its late completion', async () => {
    let resolveOld!: (valid: boolean) => void;
    let oldSignal: AbortSignal | undefined;
    vi.spyOn(HttpClient, 'verifyToken')
      .mockImplementationOnce((_url, _token, options) => {
        oldSignal = options?.signal;
        return new Promise(resolve => { resolveOld = resolve; });
      })
      .mockResolvedValue(true);
    const hook = mount();
    await flush();
    act(() => hook.result.current.retry());
    await flush();
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => resolveOld(true));
    expect(FakeSocket.instances).toHaveLength(1);
    hook.unmount();
  });

  test('watchdog aborts stuck preflight and replaces the attempt', async () => {
    let oldSignal: AbortSignal | undefined;
    vi.spyOn(HttpClient, 'verifyToken')
      .mockImplementationOnce((_url, _token, options) => {
        oldSignal = options?.signal;
        return new Promise(() => {});
      })
      .mockResolvedValue(true);
    const hook = mount();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    await flush();
    expect(oldSignal?.aborted).toBe(true);
    expect(FakeSocket.instances).toHaveLength(1);
    hook.unmount();
  });

  test('invalid credentials stop automatic retries and do not open a socket', async () => {
    const verify = vi.spyOn(HttpClient, 'verifyToken').mockResolvedValue(false);
    const hook = mount();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances).toHaveLength(0);
    expect(useConnectionStore.getState().authError).toContain('Authentication failed');
    hook.unmount();
  });

  test('temporary preflight failure attempts WebSocket without an auth error', async () => {
    vi.spyOn(HttpClient, 'verifyToken').mockRejectedValue(new Error('HTTP 503'));
    const hook = mount();
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(useConnectionStore.getState().authError).toBeNull();
    hook.unmount();
  });
});
