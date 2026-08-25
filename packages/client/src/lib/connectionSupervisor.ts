import { queryClient } from '@/components/providers/QueryProvider';
import { useConnectionStore } from '@/stores/connectionStore';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import type { ProkopaiClient } from '@prokopai/sdk';

const CONNECTION_TIMEOUT = 10000;
const INITIAL_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;
const STALE_OPS_INTERVAL = 15000;

type ClientRef = { current: ProkopaiClient | null };

export interface ConnectionSupervisorOptions {
  serverUrl: () => string | null;
  clientRef: ClientRef;
  requestReconnect: () => void;
  invalidateAllQueries?: () => void;
}

let opts: ConnectionSupervisorOptions | null = null;
let unsubscribeStore: (() => void) | null = null;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;
let countdownInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function clearWatchdog(): void {
  if (watchdogTimer !== null) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

function clearCountdown(): void {
  if (countdownInterval !== null) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function clearBackoff(): void {
  if (backoffTimer !== null) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
  clearCountdown();
}

export function markConnectionAttempt(): void {
  clearWatchdog();
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    if (useConnectionStore.getState().connected) return;
    useConnectionStore.getState().setConnectionTimedOut(true);
  }, CONNECTION_TIMEOUT);
}

function startBackoff(): void {
  const retryCount = useConnectionStore.getState().retryCount;
  const delay = Math.min(
    INITIAL_RETRY_DELAY * Math.pow(2, retryCount),
    MAX_RETRY_DELAY,
  );
  let countdown = Math.floor(delay / 1000);
  useConnectionStore.getState().setNextRetryIn(countdown);

  clearBackoff();
  countdownInterval = setInterval(() => {
    countdown -= 1;
    useConnectionStore.getState().setNextRetryIn(Math.max(0, countdown));
  }, 1000);
  backoffTimer = setTimeout(() => {
    backoffTimer = null;
    clearCountdown();
    useConnectionStore.getState().setRetryCount((c) => c + 1);
    opts?.requestReconnect();
  }, delay);
}

function handleOnline(): void {
  if (!opts || !opts.serverUrl()) return;
  const client = opts.clientRef.current;
  if (client && client.connected) return;
  const store = useConnectionStore.getState();
  store.setConnected(false);
  store.setRetryCount(0);
  store.setConnectionTimedOut(false);
  opts.requestReconnect();
}

function handleVisibilityChange(): void {
  if (!opts || document.visibilityState !== 'visible') return;
  if (opts.clientRef.current?.ws?.readyState === WebSocket.OPEN) return;
  if (!opts.serverUrl()) return;
  const store = useConnectionStore.getState();
  store.setRetryCount(0);
  store.setConnectionTimedOut(false);
  opts.requestReconnect();
}

export function startConnectionSupervisor(options: ConnectionSupervisorOptions): void {
  stopConnectionSupervisor();
  opts = options;

  unsubscribeStore = useConnectionStore.subscribe((curr, prev) => {
    if (curr.connected) {
      clearWatchdog();
      clearBackoff();
      if (!prev.connected) {
        const invalidate =
          opts?.invalidateAllQueries ?? (() => queryClient.invalidateQueries());
        invalidate();
      }
      return;
    }
    if (curr.connectionTimedOut && !prev.connectionTimedOut) {
      startBackoff();
    }
  });

  window.addEventListener('online', handleOnline);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  cleanupInterval = setInterval(() => {
    usePendingOperationsStore.getState().cleanupStaleOperations();
  }, STALE_OPS_INTERVAL);

  const state = useConnectionStore.getState();
  if (state.connectionTimedOut && !state.connected) {
    startBackoff();
  }
}

export function stopConnectionSupervisor(): void {
  unsubscribeStore?.();
  unsubscribeStore = null;
  window.removeEventListener('online', handleOnline);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  clearWatchdog();
  clearBackoff();
  if (cleanupInterval !== null) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  opts = null;
}
