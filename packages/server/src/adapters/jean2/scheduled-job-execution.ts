import { getModelsConfig } from '@/config';
import type { ScheduledJob, Session } from '@prokopai/sdk';
import { getDefaultPreconfig, getPreconfig } from '@/infrastructure/config/preconfig';
import { createScheduledJobRunner } from '@/infrastructure/scheduling/scheduled-job-runner';
import { createSession, getSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace, getWorkspacePermissionMode } from '@/infrastructure/sqlite/workspaces';
import { markScheduledJobError, markScheduledJobRun } from '@/infrastructure/sqlite/scheduled-job-store';
import type { ScheduledJobExecutionPort, ScheduledJobRepositoryPort } from '@/application/ports/scheduling';

export interface Jean2ScheduledJobExecutionOptions {
  /** Tells clients about the new run session; scheduled runs have no connection of their own. */
  announceSession?: (session: Session) => void;
  /** Run bookkeeping. Defaults to the store; bootstrap passes the change-reporting repository. */
  runs?: Pick<ScheduledJobRepositoryPort, 'markRun' | 'markError'>;
}

/**
 * Jean2 scheduled-job execution adapter. Harness-agnostic since S11.3: the
 * runner dispatches headless child runs through the installed
 * HeadlessSessionRunPort, and the owning harness enters its own runtime
 * scope, so this adapter no longer reaches any harness internals.
 */
export function createJean2ScheduledJobExecution(
  {
    announceSession = () => {},
    runs = { markRun: markScheduledJobRun, markError: markScheduledJobError },
  }: Jean2ScheduledJobExecutionOptions = {},
  runner: Pick<ScheduledJobExecutionPort, 'run'> = createScheduledJobRunner({
    repository: runs,
    sessions: {
      createSession: (...input: Parameters<typeof createSession>) => {
        const session = createSession(...input);
        announceSession(session);
        return session;
      },
      getSession,
    },
    workspaces: { getWorkspace, permissionMode: getWorkspacePermissionMode },
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
