import { getModelsConfig } from '@/config';
import { getDefaultPreconfig, getPreconfig } from '@/infrastructure/configuration/preconfig';
import { createScheduledJobRunner } from '@/infrastructure/scheduling/scheduled-job-runner';
import { createSession, getSession } from '@/store/sessions';
import { getWorkspace, getWorkspaceAutoApproveSeverity } from '@/store/workspaces';
import { markScheduledJobError, markScheduledJobRun } from '@/store/scheduled-jobs';
import type { ScheduledJobExecutionPort } from '@/application/ports/scheduling';

export function createJean2ScheduledJobExecution(): ScheduledJobExecutionPort {
  const runner = createScheduledJobRunner({
    repository: {
      markRun: markScheduledJobRun,
      markError: markScheduledJobError,
    },
    sessions: { createSession, getSession },
    workspaces: { getWorkspace, getAutoApproveSeverity: getWorkspaceAutoApproveSeverity },
    preconfigs: { getPreconfig, getDefaultPreconfig },
    modelsConfig: { getModelsConfig },
  });

  return {
    run(job) {
      return runner.run(job);
    },

    trigger(job) {
      runner.run(job).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[scheduler] Manual trigger of '${job.name}' failed:`, message);
      });
    },
  };
}
