import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { useConnectionStore } from '@/stores/connectionStore';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import { startConnectionSupervisor, stopConnectionSupervisor, markConnectionAttempt } from '@/lib/connectionSupervisor';
import type { ProkopaiClient } from '@prokopai/sdk';

const freshness = vi.fn(() => false);
const clientRef = { current: { checkConnectionFreshness: freshness } as unknown as ProkopaiClient };
function start(requestReconnect = vi.fn(), cancelAttempt = vi.fn(), invalidateAllQueries = vi.fn()) {
  startConnectionSupervisor({ serverUrl: () => 'http://test', clientRef, requestReconnect, cancelAttempt, invalidateAllQueries });
  return { requestReconnect, cancelAttempt, invalidateAllQueries };
}

describe('connectionSupervisor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopConnectionSupervisor();
    useConnectionStore.getState().resetConnection();
    usePendingOperationsStore.setState({ operations: [] });
    freshness.mockReset().mockReturnValue(false);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });
  afterEach(() => {
    stopConnectionSupervisor();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('watchdog cancels the attempt after 10 seconds', () => {
    const { cancelAttempt } = start();
    markConnectionAttempt();
    vi.advanceTimersByTime(10_000);
    expect(cancelAttempt).toHaveBeenCalledTimes(1);
  });

  test('first retry is immediate and the next attempt clears the countdown', () => {
    const { requestReconnect } = start();
    useConnectionStore.getState().setConnectionTimedOut(true);
    vi.advanceTimersByTime(0);
    expect(requestReconnect).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState()).toMatchObject({ retryCount: 1, connectionTimedOut: false, nextRetryIn: 0 });
  });

  test('visible retry gaps stay below three seconds after long outages', () => {
    const { requestReconnect } = start();
    useConnectionStore.getState().setRetryCount(100);
    useConnectionStore.getState().setConnectionTimedOut(true);
    expect(useConnectionStore.getState().nextRetryIn).toBe(3);
    vi.advanceTimersByTime(2699);
    expect(requestReconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestReconnect).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState().nextRetryIn).toBe(0);
  });

  test('hidden retries back off but foreground recovery bypasses the wait', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { requestReconnect } = start();
    useConnectionStore.getState().setRetryCount(10);
    useConnectionStore.getState().setConnectionTimedOut(true);
    expect(useConnectionStore.getState().nextRetryIn).toBe(27);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(30_000);
    expect(requestReconnect).toHaveBeenCalledTimes(1);
  });

  test('foreground does not replace an active attempt or fresh connection', () => {
    const { requestReconnect } = start();
    markConnectionAttempt();
    window.dispatchEvent(new Event('online'));
    expect(requestReconnect).not.toHaveBeenCalled();
    useConnectionStore.getState().setConnected(true);
    freshness.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(requestReconnect).not.toHaveBeenCalled();
  });

  test('stale foreground check coalesces its close event with immediate recovery', () => {
    const { requestReconnect } = start();
    useConnectionStore.getState().setConnected(true);
    freshness.mockImplementation(() => {
      useConnectionStore.setState({ connected: false, connectionTimedOut: true });
      return false;
    });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(30_000);
    expect(requestReconnect).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState().retryCount).toBe(0);
  });

  test('a new attempt clears stale authentication and connected state', () => {
    start();
    useConnectionStore.setState({ authError: 'Old token', connected: true });
    markConnectionAttempt();
    expect(useConnectionStore.getState()).toMatchObject({ authError: null, connected: false });
  });

  test('authentication failure stops retries including browser triggers', () => {
    const { requestReconnect, cancelAttempt } = start();
    markConnectionAttempt();
    useConnectionStore.setState({ authError: 'Invalid token', connectionTimedOut: true });
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event('online'));
    expect(requestReconnect).not.toHaveBeenCalled();
    expect(cancelAttempt).not.toHaveBeenCalled();
  });

  test('connection success invalidates once and clears timers', () => {
    const { requestReconnect, invalidateAllQueries } = start();
    useConnectionStore.getState().setConnectionTimedOut(true);
    useConnectionStore.getState().setConnected(true);
    vi.advanceTimersByTime(30_000);
    expect(invalidateAllQueries).toHaveBeenCalledTimes(1);
    expect(requestReconnect).not.toHaveBeenCalled();
  });

  test('stop clears every timer', () => {
    const { requestReconnect } = start();
    markConnectionAttempt();
    stopConnectionSupervisor();
    vi.advanceTimersByTime(30_000);
    expect(requestReconnect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
