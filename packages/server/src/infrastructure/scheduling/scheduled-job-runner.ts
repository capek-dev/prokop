import { randomUUID } from 'crypto';
import type { Preconfig, ScheduledJob, Session } from '@prokopai/sdk';
import { executeChildSession, findProviderFromModel } from '@/adapters/capek/contracts';
import type {
  ScheduledJobRepositoryPort,
  ScheduledRunModelsConfigPort,
  ScheduledRunPreconfigPort,
  ScheduledRunSessionPort,
  ScheduledRunWorkspacePort,
} from '@/application/ports/scheduling';

export interface ScheduledJobRunnerDeps {
  repository: Pick<ScheduledJobRepositoryPort, 'markRun' | 'markError'>;
  sessions: ScheduledRunSessionPort;
  workspaces: ScheduledRunWorkspacePort;
  preconfigs: ScheduledRunPreconfigPort;
  modelsConfig: ScheduledRunModelsConfigPort;
}

export function createScheduledJobRunner(deps: ScheduledJobRunnerDeps): {
  run(job: ScheduledJob): Promise<void>;
} {
  return {
    async run(job): Promise<void> {
      const preconfig = job.preconfigId
        ? await deps.preconfigs.getPreconfig(job.preconfigId)
        : await deps.preconfigs.getDefaultPreconfig();

      if (!preconfig) {
        throw new Error('No preconfig available for scheduled job execution');
      }

      const config = deps.modelsConfig.getModelsConfig();
      const workspace = deps.workspaces.getWorkspace(job.workspaceId);
      const modelId = preconfig.model || config.defaultModel;
      const providerId =
        preconfig.provider ||
        findProviderFromModel(modelId) ||
        config.defaultProvider;
      const autoApproveSeverity =
        job.autoApproveSeverity ?? deps.workspaces.getAutoApproveSeverity(job.workspaceId);

      let sessionId: string;
      let resumeFromHistory = false;

      if (job.reuseSession && job.lastRunSessionId) {
        const existing = deps.sessions.getSession(job.lastRunSessionId);
        if (existing && existing.status === 'active') {
          sessionId = existing.id;
          resumeFromHistory = job.includeHistory;
          console.log(
            `[scheduler] Reusing session ${sessionId} for job '${job.name}' (history: ${resumeFromHistory})`,
          );
        } else {
          sessionId = createScheduledSession(deps.sessions, job, preconfig, modelId, providerId, autoApproveSeverity);
        }
      } else {
        sessionId = createScheduledSession(deps.sessions, job, preconfig, modelId, providerId, autoApproveSeverity);
      }

      const safePreconfig: Preconfig = {
        ...preconfig,
        tools: (preconfig.tools ?? []).filter((toolName) => toolName !== 'scheduler'),
      };

      console.log(`[scheduler] Running job '${job.name}' in session ${sessionId}`);

      const result = await executeChildSession({
        parentSessionId: sessionId,
        childSessionId: sessionId,
        preconfig: safePreconfig,
        prompt: job.prompt,
        workspacePath: workspace?.path || undefined,
        workspaceId: job.workspaceId,
        modelId,
        providerId,
        resumeFromHistory,
      });

      deps.repository.markRun(job.id, sessionId);
      if (result.error) {
        deps.repository.markError(job.id, result.error);
      }
    },
  };
}

function createScheduledSession(
  sessions: ScheduledRunSessionPort,
  job: ScheduledJob,
  preconfig: Preconfig,
  modelId: string,
  providerId: string,
  autoApproveSeverity: Session['autoApproveSeverity'],
): string {
  const sessionId = randomUUID();
  sessions.createSession({
    id: sessionId,
    workspaceId: job.workspaceId,
    preconfigId: preconfig.id,
    title: `[Scheduled] ${job.name}`,
    status: 'active',
    metadata: { scheduledJobId: job.id },
    parentId: null,
    agentName: null,
    selectedModel: modelId,
    selectedProvider: providerId,
    selectedVariant: preconfig.variant ?? null,
    autoApproveSeverity,
  });
  return sessionId;
}
