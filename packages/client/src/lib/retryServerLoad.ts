import { ConnectionError, ServerError } from '@prokopai/sdk';

function waitForRecovery(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', foreground);
    };
    const wake = () => { cleanup(); resolve(); };
    const abort = () => { cleanup(); reject(signal.reason); };
    const foreground = () => {
      if (document.visibilityState === 'visible') wake();
    };
    const timer = setTimeout(wake, delay);
    signal.addEventListener('abort', abort, { once: true });
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', foreground);
    if (signal.aborted) abort();
  });
}

/** Retry read-only route bootstrap requests, never mutations or authentication failures. */
export async function retryServerLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let failures = 0;
  while (true) {
    signal.throwIfAborted();
    const attempt = new AbortController();
    const abort = () => attempt.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      attempt.abort(new DOMException('Server request timed out', 'TimeoutError'));
    }, 10_000);
    try {
      const result = await load(attempt.signal);
      signal.throwIfAborted();
      return result;
    } catch (error: unknown) {
      signal.throwIfAborted();
      // Native fetch rejects with TypeError on connection refusal or network failure.
      const networkFailure = error instanceof TypeError
        && /failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(error.message);
      const retryable = timedOut || networkFailure || error instanceof ConnectionError
        || (error instanceof ServerError && error.statusCode >= 500);
      if (!retryable) throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      // A failed Promise.all must not leave sibling bootstrap requests running.
      attempt.abort();
    }
    const cap = document.visibilityState === 'hidden' ? 30_000 : 3_000;
    const delay = Math.min(1000 * 2 ** Math.min(failures++, 5), cap) * (0.8 + Math.random() * 0.2);
    await waitForRecovery(delay, signal);
  }
}
