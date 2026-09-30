import { getModelsConfig } from '@/config';
import type { ScheduledJob } from '@prokopai/sdk';
import { getDefaultPreconfig, getPreconfig } from '@/infrastructure/config/preconfig';
import { createScheduledJobRunner } from '@/infrastructure/scheduling/scheduled-job-runner';
import { createSession, getSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace, getWorkspaceAutoApproveSeverity } from '@/infrastructure/sqlite/workspaces';
import { markScheduledJobError, markScheduledJobRun } from '@/infrastructure/sqlite/scheduled-job-store';
import type { ScheduledJobExecutionPort } from '@/application/ports/scheduling';

/**
 * Jean2 scheduled-job execution adapter. Harness-agnostic since S11.3: the
 * runner dispatches headless child runs through the installed
 * HeadlessSessionRunPort, and the owning harness enters its own runtime
 * scope, so this adapter no longer reaches any harness internals.
 */
export function createJean2ScheduledJobExecution(
  runner: Pick<ScheduledJobExecutionPort, 'run'> = createScheduledJobRunner({
    repository: {
      markRun: markScheduledJobRun,
      markError: markScheduledJobError,
    },
    sessions: { createSession, getSession },
    workspaces: { getWorkspace, getAutoApproveSeverity: getWorkspaceAutoApproveSeverity },
    preconfigs: { getPreconfig, getDefaultPreconfig },
    modelsConfig: { getModelsConfig },
  }),
): ScheduledJobExecutionPort {
  return {
    run(job: ScheduledJob) {
      return runner.run(job);
    },

    trigger(job: ScheduledJob) {
      runner.run(job).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[scheduler] Manual trigger of '${job.name}' failed:`, message);
      });
    },
  };
}
