import { RETRY_INTERVAL_MS } from '@/domains/notifications';
import { getJean2NotificationsApplication } from '@/adapters/jean2/notifications';

/**
 * S5 web-push delivery retry scheduler. The retry attempt classification,
 * backoff, and exhaustion policy live in the notification domain and the
 * orchestration lives in the notification application; this module owns
 * only the interval, the startup tick, the stop, and the 30-day delivery
 * cleanup with their exact log lines.
 */

let retryInterval: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  await getJean2NotificationsApplication().runRetryTick();
}

/**
 * Start the push delivery retry loop.
 * Runs on a 2-minute interval, re-dispatching deliveries marked as
 * 'pending_retry' whose next_attempt_at has passed.
 */
export function startPushRetryScheduler(): void {
  if (retryInterval) return;
  console.log('[web-push] Starting delivery retry scheduler (120s interval)');
  retryInterval = setInterval(() => {
    void tick().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[web-push] Retry scheduler tick error: ${message}`);
    });
  }, RETRY_INTERVAL_MS);

  // Run an immediate tick on startup to retry deliveries left from a crash/restart
  void tick().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[web-push] Startup retry tick error: ${message}`);
  });
}

/**
 * Stop the push delivery retry loop.
 */
export function stopPushRetryScheduler(): void {
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
    console.log('[web-push] Stopped delivery retry scheduler');
  }
}

/**
 * Clean up old delivery records and expired subscriptions.
 * Called at server startup. Deletes delivery records older than 30 days.
 */
export function cleanupPushData(): void {
  const deleted = getJean2NotificationsApplication().cleanup(Date.now());
  if (deleted > 0) {
    console.log(`[web-push] Cleaned up ${deleted} old delivery record(s)`);
  }
}
