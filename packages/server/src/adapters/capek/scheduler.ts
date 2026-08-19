import {
  configureSchedulerHost,
  type SchedulerHost,
} from '@capekai/core/hosts';
import type {
  ScheduledJobExecutionPort,
  ScheduledJobRepositoryPort,
} from '@/application/ports/scheduling';

/**
 * S4/S5 Capek scheduler adapter: translates `SchedulerHost` calls onto the
 * scheduled-job repository and execution ports. No store, runner, SQL, or
 * infrastructure imports; the composition root injects concrete deps. The
 * module-level `jean2SchedulerHost` identity and `configureJean2SchedulerHost`
 * are preserved; the no-arg configure resets the deps to the Capek
 * unconfigured-host semantics.
 */
export interface Jean2SchedulerHostDeps {
  repository: ScheduledJobRepositoryPort;
  execution: ScheduledJobExecutionPort;
}

let activeDeps: Jean2SchedulerHostDeps | null = null;

export const jean2SchedulerHost: SchedulerHost = {
  create(workspaceId, input) {
    if (!activeDeps) {
      throw new Error('Scheduler host is not configured');
    }
    return activeDeps.repository.create(workspaceId, input);
  },
  get: (id) => activeDeps?.repository.get(id) ?? null,
  list: (workspaceId) => activeDeps?.repository.list(workspaceId) ?? [],
  update: (id, updates) => activeDeps?.repository.update(id, updates) ?? null,
  delete: (id) => activeDeps?.repository.delete(id) ?? false,
  trigger(job) {
    if (!activeDeps) return;
    activeDeps.execution.run(job).catch((error: unknown) => {
      console.error(`[scheduler-tool] Trigger of '${job.name}' failed:`, error);
    });
  },
};

/** Passing deps configures them; no-arg call resets to the unconfigured-host
 * defaults so tests can restore a deterministic state after fake-deps wiring. */
export function configureJean2SchedulerHost(deps?: Jean2SchedulerHostDeps): void {
  activeDeps = deps ?? null;
  configureSchedulerHost(jean2SchedulerHost);
}
