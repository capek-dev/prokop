import { withJean2ExecutionScope } from '@/adapters/capek/execution-scope';
import { getModelsConfig } from '@/config';
import type { ScheduledJob } from '@jean2/sdk';
import { getDefaultPreconfig, getPreconfig } from '@/infrastructure/configuration/preconfig';
import { createScheduledJobRunner } from '@/infrastructure/scheduling/scheduled-job-runner';
import { createSession, getSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace, getWorkspaceAutoApproveSeverity } from '@/infrastructure/sqlite/workspaces';
import { markScheduledJobError, markScheduledJobRun } from '@/infrastructure/sqlite/scheduled-job-store';
import type { ScheduledJobExecutionPort } from '@/application/ports/scheduling';

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
      return withJean2ExecutionScope(() => runner.run(job));
    },

    trigger(job: ScheduledJob) {
      withJean2ExecutionScope(() => runner.run(job)).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[scheduler] Manual trigger of '${job.name}' failed:`, message);
      });
    },
  };
}
