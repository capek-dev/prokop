import type { LearningReviewer, Preconfig, Workspace, WorkspaceLearningSettings } from '@prokopai/sdk';
import type { LearningRepository } from '@/infrastructure/sqlite/learning-repository';
import { buildLearningPrompt } from '@/domains/learning/prompt';

export interface LearningReviewRunnerDependencies {
  repository: LearningRepository;
  workspace(id: string): Workspace | null;
  /** Effective learning settings: agent homes resolve from the owning
   * agent's config, other workspaces from stored settings. */
  learningSettings(workspace: Workspace): Promise<WorkspaceLearningSettings | null>;
  preconfig(id: string): Promise<Preconfig | null>;
  modelAvailable(provider: string, model: string): boolean;
  eligible(workspace: Workspace, messageId: string): boolean;
  execute(input: {
    runId: string;
    workspace: Workspace;
    reviewer: LearningReviewer;
    preconfig: Preconfig;
    prompt: string;
    messageIds: string[];
    signal: AbortSignal;
    /** Resolved learning sources (agent config for homes, stored settings
     * otherwise) used by the evidence reader inside execution. */
    sources: WorkspaceLearningSettings['sources'];
    /** Resolved improve-skills permission: learning opt-in AND the skills
     * surface enabled (agent capabilities for homes, workspace setting
     * otherwise). */
    improveSkills: boolean;
  }): Promise<{ error?: string }>;
  now(): number;
  /** Test seam; production reviews have a fifteen-minute execution budget. */
  timeoutMs?: number;
}

/** One bounded batch. Production execution must supply restricted tool composition,
 * rechecking this authorization at each evidence read and knowledge activation. */
export function createLearningReviewRunner(deps: LearningReviewRunnerDependencies): {
  run(workspaceId: string, reviewerId: string, signal: AbortSignal): Promise<boolean>;
} {
  const timeoutMs = deps.timeoutMs ?? 15 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15 * 60_000) throw new Error('Invalid learning execution budget');
  return {
    async run(workspaceId, reviewerId, parentSignal) {
      const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(timeoutMs)]);
      if (signal.aborted) return false;
      const workspace = deps.workspace(workspaceId);
      const settings = workspace?.settings;
      if (!workspace || !settings) return false;
      const learning = await deps.learningSettings(workspace);
      if (!learning?.enabled) return false;
      const reviewer = learning.reviewers.find(item => item.id === reviewerId);
      if (!reviewer) return false;
      if (settings.isAgentHome && reviewer.preconfigId !== settings.agentId) return false;
      // Resolve the model before claiming a run: an unavailable model skips
      // this cycle silently instead of recording an error run. Default-on
      // learning must not spam errors on credential-less installs.
      const preconfig = await deps.preconfig(reviewer.preconfigId);
      signal.throwIfAborted();
      if (!preconfig) return false;
      const selected = reviewer.modelOverride;
      const model = selected?.modelId ?? preconfig.model;
      const provider = selected?.providerId ?? preconfig.provider;
      if (!model || !provider || !deps.modelAvailable(provider, model)) {
        console.info(`[learning] Skipping review: model ${provider ?? '?'}/${model ?? '?'} is unavailable`);
        return false;
      }
      const run = deps.repository.claim(workspaceId, reviewerId, deps.now(), 3_600_000, 20, id => deps.eligible(workspace, id));
      if (!run) return false;
      try {
        const evidence = deps.repository.evidence(run.id);
        if (!evidence.length || evidence.some(item => !deps.eligible(workspace, item.message_id))) {
          throw new Error('Learning evidence eligibility changed');
        }
        signal.throwIfAborted();
        const prompt = buildLearningPrompt({
          scope: settings.isAgentHome ? 'agent' : 'workspace', memoryEnabled: true, sessionSearchEnabled: true,
          improveSkills: learning.improveSkills,
          skillManagementEnabled: settings.isAgentHome
            ? preconfig.capabilities?.skills !== false
            : settings.skills?.managementEnabled === true,
          instructions: learning.instructions, reviewerInstructions: reviewer.instructions,
        });
        const result = await deps.execute({
          runId: run.id, workspace, reviewer,
          preconfig: { ...preconfig, model, provider, variant: selected ? selected.variant ?? null : preconfig.variant },
          prompt, messageIds: evidence.map(item => item.message_id), signal,
          sources: learning.sources,
          improveSkills: learning.improveSkills && (settings.isAgentHome
            ? preconfig.capabilities?.skills !== false
            : settings.skills?.managementEnabled === true),
        });
        signal.throwIfAborted();
        if (result.error) throw new Error(result.error);
        if (!deps.repository.finish(run.id, deps.now(), { success: true })) throw new Error('Learning changes need reconciliation');
        return true;
      } catch (error: unknown) {
        deps.repository.finish(run.id, deps.now(), { success: false, interrupted: parentSignal.aborted, error: error instanceof Error ? error.message : 'Learning review failed' });
        return false;
      }
    },
  };
}
