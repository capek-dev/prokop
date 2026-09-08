import { queryClient } from '@/components/providers/QueryProvider';
import { useConnectionStore } from '@/stores/connectionStore';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import type { ProkopaiClient } from '@prokopai/sdk';

const CONNECTION_TIMEOUT = 10000;
const STALE_OPS_INTERVAL = 15000;

type ClientRef = { current: ProkopaiClient | null };

export interface ConnectionSupervisorOptions {
  serverUrl: () => string | null;
  clientRef: ClientRef;
  requestReconnect: () => void;
  cancelAttempt?: () => void;
  invalidateAllQueries?: () => void;
}

let opts: ConnectionSupervisorOptions | null = null;
let unsubscribeStore: (() => void) | null = null;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;
let countdownInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let attemptInFlight = false;

function clearWatchdog(): void {
  if (watchdogTimer !== null) clearTimeout(watchdogTimer);
  watchdogTimer = null;
}

function clearBackoff(): void {
  if (backoffTimer !== null) clearTimeout(backoffTimer);
  if (countdownInterval !== null) clearInterval(countdownInterval);
  backoffTimer = null;
  countdownInterval = null;
}

export function markConnectionAttempt(): void {
  clearWatchdog();
  clearBackoff();
  attemptInFlight = true;
  useConnectionStore.setState({ connected: false, authError: null, connectionTimedOut: false, nextRetryIn: 0 });
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    if (useConnectionStore.getState().connected) return;
    opts?.cancelAttempt?.();
    useConnectionStore.getState().setConnectionTimedOut(true);
  }, CONNECTION_TIMEOUT);
}

function requestReconnect(): void {
  if (!opts || attemptInFlight || useConnectionStore.getState().authError) return;
  clearBackoff();
  attemptInFlight = true;
  useConnectionStore.setState({ connectionTimedOut: false, nextRetryIn: 0 });
  opts.requestReconnect();
}

function startBackoff(): void {
  clearWatchdog();
  clearBackoff();
  attemptInFlight = false;
  const retryCount = useConnectionStore.getState().retryCount;
  const cap = document.visibilityState === 'hidden' ? 30_000 : 3_000;
  // Immediate first recovery; downward jitter keeps the maximum gap bounded.
  const delay = retryCount === 0 ? 0
    : Math.min(1000 * 2 ** Math.min(retryCount - 1, 5), cap) * (0.8 + Math.random() * 0.2);
  const deadline = Date.now() + delay;
  const updateCountdown = () => {
    useConnectionStore.getState().setNextRetryIn(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  };
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
  backoffTimer = setTimeout(() => {
    useConnectionStore.getState().setRetryCount(c => c + 1);
    requestReconnect();
  }, delay);
}

function recoverConnection(): void {
  if (!opts || !opts.serverUrl() || useConnectionStore.getState().authError) return;
  if (opts.clientRef.current?.checkConnectionFreshness()) return;
  if (attemptInFlight) return;
  useConnectionStore.getState().setRetryCount(0);
  requestReconnect();
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') recoverConnection();
  else if (backoffTimer !== null) startBackoff();
}

export function startConnectionSupervisor(options: ConnectionSupervisorOptions): void {
  stopConnectionSupervisor();
  opts = options;
  unsubscribeStore = useConnectionStore.subscribe((curr, prev) => {
    if (curr.authError || curr.connected) {
      clearWatchdog();
      clearBackoff();
      attemptInFlight = false;
      if (curr.connected && !prev.connected) {
        const invalidate = opts?.invalidateAllQueries ?? (() => queryClient.invalidateQueries());
        invalidate();
      }
      return;
    }
    if (curr.connectionTimedOut && !prev.connectionTimedOut) startBackoff();
  });
  window.addEventListener('online', recoverConnection);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  cleanupInterval = setInterval(() => {
    usePendingOperationsStore.getState().cleanupStaleOperations();
  }, STALE_OPS_INTERVAL);
}

export function stopConnectionSupervisor(): void {
  unsubscribeStore?.();
  unsubscribeStore = null;
  window.removeEventListener('online', recoverConnection);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  clearWatchdog();
  clearBackoff();
  if (cleanupInterval !== null) clearInterval(cleanupInterval);
  cleanupInterval = null;
  attemptInFlight = false;
  opts = null;
}
