import type {
  ScheduledJobExecutionPort,
  ScheduledJobRepositoryPort,
} from '../ports/scheduling';

export const SCHEDULER_TICK_INTERVAL_MS = 60_000;

export interface SchedulingTickerDeps {
  repository: ScheduledJobRepositoryPort;
  execution: ScheduledJobExecutionPort;
}

/**
 * Scheduled-job tick loop. Owns the due-query cadence, the at-most-once
 * advance-before-execute ordering, and the failure bookkeeping (log plus
 * `markError`). The legacy `scheduler/index.ts` module installs this ticker
 * from bootstrap and keeps `startScheduler`/`stopScheduler` as the
 * compatibility entrypoints.
 */
export interface SchedulingTicker {
  start(): void;
  stop(): void;
  tick(): Promise<void>;
}

export function createSchedulingTicker(deps: SchedulingTickerDeps): SchedulingTicker {
  let schedulerInterval: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      const dueJobs = deps.repository.getDue(now);
      if (dueJobs.length === 0) return;

      console.log(`[scheduler] ${dueJobs.length} job(s) due`);

      for (const job of dueJobs) {
        // At-most-once: advance nextRunAt BEFORE execution. The repository
        // applies the scheduling domain completion policy.
        deps.repository.advance(job.id);

        // Execute the job (fire-and-forget with error capture)
        deps.execution.run(job).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[scheduler] Job '${job.name}' failed:`, message);
          deps.repository.markError(job.id, message);
        });
      }
    } finally {
      ticking = false;
    }
  }

  return {
    start() {
      if (schedulerInterval) return;
      console.log('[scheduler] Starting scheduler (60s tick interval)');
      schedulerInterval = setInterval(() => {
        tick().catch((err: unknown) => console.error('[scheduler] tick error:', err));
      }, SCHEDULER_TICK_INTERVAL_MS);

      // Run an immediate tick on startup to catch jobs that became due while offline
      tick().catch((err: unknown) => console.error('[scheduler] startup tick error:', err));
    },

    stop() {
      if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
        console.log('[scheduler] Stopped scheduler');
      }
    },

    tick,
  };
}
