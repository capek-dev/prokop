import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { useConnectionStore } from '@/stores/connectionStore';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import {
  startConnectionSupervisor,
  stopConnectionSupervisor,
  markConnectionAttempt,
} from '@/lib/connectionSupervisor';
import type { ProkopaiClient } from '@prokopai/sdk';

const clientRef: { current: ProkopaiClient | null } = {
  current: { connected: false, ws: { readyState: 0 } } as unknown as ProkopaiClient,
};

function startSupervisor(requestReconnect: () => void, invalidateAllQueries: () => void): void {
  startConnectionSupervisor({
    serverUrl: () => 'ws://test',
    clientRef,
    requestReconnect,
    invalidateAllQueries,
  });
}

describe('connectionSupervisor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopConnectionSupervisor();
    useConnectionStore.getState().resetConnection();
    usePendingOperationsStore.setState({ operations: [] });
  });

  afterEach(() => {
    stopConnectionSupervisor();
    useConnectionStore.getState().resetConnection();
    usePendingOperationsStore.setState({ operations: [] });
    vi.useRealTimers();
  });

  test('watchdog marks the connection as timed out after 10s', () => {
    markConnectionAttempt();
    vi.advanceTimersByTime(10_000);
    expect(useConnectionStore.getState().connectionTimedOut).toBe(true);
  });

  test('backoff increments retry count and requests reconnect after the delay', () => {
    const requestReconnect = vi.fn();
    startSupervisor(requestReconnect, vi.fn());

    useConnectionStore.getState().setConnectionTimedOut(true);
    expect(useConnectionStore.getState().nextRetryIn).toBe(1);

    vi.advanceTimersByTime(1_000);

    expect(requestReconnect).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState().retryCount).toBe(1);
  });

  test('connected transition invalidates all queries and clears timers', () => {
    const requestReconnect = vi.fn();
    const invalidateAllQueries = vi.fn();
    startSupervisor(requestReconnect, invalidateAllQueries);

    useConnectionStore.getState().setConnectionTimedOut(true);
    markConnectionAttempt();
    useConnectionStore.getState().setConnected(true);

    expect(invalidateAllQueries).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);

    expect(requestReconnect).not.toHaveBeenCalled();
  });

  test('stop clears all timers', () => {
    const requestReconnect = vi.fn();
    startSupervisor(requestReconnect, vi.fn());

    useConnectionStore.getState().setConnectionTimedOut(true);
    markConnectionAttempt();
    stopConnectionSupervisor();

    vi.advanceTimersByTime(30_000);

    expect(requestReconnect).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().connectionTimedOut).toBe(true);
  });
});
