import { randomUUID } from 'crypto';
import type { Preconfig, ScheduledJob, Session } from '@prokopai/sdk';
import { findProviderFromModel } from '@/infrastructure/providers/model-selection';
import { modelVariantKeys, resolveSessionVariant } from '@/domains/sessions/variant';
import { getHeadlessExecutionPort, type HeadlessSessionRunPort } from '@/application/ports/headless-execution';
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
  /** Test seam; production dispatches through the installed headless port. */
  headless?: Pick<HeadlessSessionRunPort, 'run'>;
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
      const jobHarness = job.harness ?? 'prokop';
      // A preconfig model pin applies only to a matching harness; on any other
      // harness the pin is ignored and the job follows the configured defaults.
      const pinApplies = (preconfig.modelHarness ?? 'prokop') === jobHarness;
      const pinnedModel = pinApplies ? preconfig.model : null;
      const modelId = pinnedModel || config.defaultModel;
      const providerId =
        (pinApplies ? preconfig.provider : null) ||
        findProviderFromModel(modelId) ||
        config.defaultProvider;
      const permissionMode =
        job.permissionMode ?? deps.workspaces.permissionMode(job.workspaceId);
      const variantKeys = modelVariantKeys(config.providers ?? [], modelId, providerId);

      // A preconfig-pinned model resolves its own variant (first key when the
      // preconfig pins none); a model-less preconfig follows the configured
      // default variant of the default model.
      const storedVariant = pinnedModel
        ? preconfig.variant ?? null
        : config.defaultVariant ?? null;

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
          sessionId = createScheduledSession(deps.sessions, job, preconfig, jobHarness, modelId, providerId, permissionMode, resolveSessionVariant(variantKeys, storedVariant));
        }
      } else {
        sessionId = createScheduledSession(deps.sessions, job, preconfig, jobHarness, modelId, providerId, permissionMode, resolveSessionVariant(variantKeys, storedVariant));
      }

      console.log(`[scheduler] Running job '${job.name}' in session ${sessionId}`);

      // Headless dispatch: the owning harness runs the child session inside
      // its own runtime scope. A missing installed port fails closed and the
      // job records the failure instead of executing.
      const headless = deps.headless ?? getHeadlessExecutionPort();
      const result = headless
        ? await headless.run({
            harness: jobHarness,
            parentSessionId: sessionId,
            childSessionId: sessionId,
            preconfig,
            prompt: job.prompt,
            workspacePath: workspace?.path || undefined,
            workspaceId: job.workspaceId,
            modelId,
            providerId,
            resumeFromHistory,
          })
        : { error: 'Scheduled execution is unavailable' };

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
  harness: Session['harness'],
  modelId: string,
  providerId: string,
  permissionMode: Session['permissionMode'],
  resolvedVariant: string | null,
): string {
  const sessionId = randomUUID();
  sessions.createSession({
    id: sessionId,
    workspaceId: job.workspaceId,
    harness,
    preconfigId: preconfig.id,
    title: `[Scheduled] ${job.name}`,
    status: 'active',
    metadata: { scheduledJobId: job.id },
    parentId: null,
    agentName: null,
    selectedModel: modelId,
    selectedProvider: providerId,
    selectedVariant: resolvedVariant,
    permissionMode,
  });
  return sessionId;
}
