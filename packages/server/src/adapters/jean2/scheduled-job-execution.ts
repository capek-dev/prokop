import { runScheduledJob } from '@/scheduler/runner';
import type { ScheduledJobExecutionPort } from '@/application/ports/scheduling';

/**
 * Jean2 scheduled-job execution adapter over the current runner
 * implementation. The runner stays at its legacy path (store plus Capek
 * compat imports) until its own slice; this adapter owns the port mapping
 * and the manual-trigger error reporting contract.
 */
export function createJean2ScheduledJobExecution(): ScheduledJobExecutionPort {
  return {
    run(job) {
      return runScheduledJob(job);
    },

    trigger(job) {
      runScheduledJob(job).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[scheduler] Manual trigger of '${job.name}' failed:`, message);
      });
    },
  };
}
