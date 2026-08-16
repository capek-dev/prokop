import type { ScheduledJob, UpdateScheduledJobInput } from '@jean2/sdk';
import { computeNextRun } from './schedule';

/**
 * Scheduling domain: scheduled-job lifecycle decisions.
 *
 * These decision functions are the exact policy previously embedded in the
 * store `advanceScheduledJob` and `updateScheduledJob` SQL builders. The
 * infrastructure repository applies them; the policy itself lives here so
 * infrastructure never decides when a job completes or how pause, resume,
 * and schedule changes recompute `next_run_at`.
 */

export type AdvanceDecision =
  | { kind: 'complete' }
  | { kind: 'reschedule'; nextRunAt: number | null };

/**
 * At-most-once advance policy: one-shot jobs and jobs whose next run reaches
 * the repeat limit complete (state `completed`, `next_run_at` null); every
 * other job reschedules from its config.
 */
export function decideNextRunAfterAdvance(job: ScheduledJob, now: number): AdvanceDecision {
  if (
    job.scheduleKind === 'once' ||
    (job.repeatLimit !== null && job.runCount + 1 >= job.repeatLimit)
  ) {
    return { kind: 'complete' };
  }
  return { kind: 'reschedule', nextRunAt: computeNextRun(job.scheduleConfig, now) };
}

export type NextRunUpdateDecision =
  | { kind: 'unchanged' }
  | { kind: 'set'; nextRunAt: number | null };

/**
 * `next_run_at` policy for job updates, mirroring the pre-S4 store clauses:
 * pausing always nulls it, an active job with a changed schedule recomputes
 * from the new config, resuming a paused job recomputes from the existing
 * config, and anything else leaves it untouched.
 */
export function decideNextRunOnUpdate(
  existing: ScheduledJob,
  updates: UpdateScheduledJobInput,
  now: number,
): NextRunUpdateDecision {
  if (updates.state === 'paused') {
    return { kind: 'set', nextRunAt: null };
  }

  const scheduleChanged =
    updates.scheduleKind !== undefined || updates.scheduleConfig !== undefined;
  if (scheduleChanged) {
    const config = updates.scheduleConfig ?? existing.scheduleConfig;
    if ((updates.state ?? existing.state) === 'active') {
      return { kind: 'set', nextRunAt: computeNextRun(config, now) };
    }
    return { kind: 'unchanged' };
  }

  if (updates.state === 'active' && existing.state === 'paused') {
    return { kind: 'set', nextRunAt: computeNextRun(existing.scheduleConfig, now) };
  }

  return { kind: 'unchanged' };
}
