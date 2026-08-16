import type { SchedulingTicker } from '@/application/scheduling/ticker';

/**
 * S4 compatibility module for the scheduler tick loop. The loop itself moved
 * to the application layer (`application/scheduling/ticker.ts`) over the
 * scheduled-job repository and execution ports; production bootstrap
 * installs a wired ticker before startup calls `startScheduler()`.
 */

let installed: SchedulingTicker | null = null;

export function installSchedulerRuntime(ticker: SchedulingTicker): void {
  installed = ticker;
}

export function startScheduler(): void {
  if (!installed) {
    throw new Error(
      'Scheduler runtime is not installed. Call installSchedulerRuntime() during bootstrap.',
    );
  }
  installed.start();
}

export function stopScheduler(): void {
  installed?.stop();
}
