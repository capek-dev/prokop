import { randomUUID } from 'crypto';
import type { Preconfig, ScheduledJob } from '@jean2/sdk';
import { createSession, getSession } from '@/store/sessions';
import { getWorkspace, getWorkspaceAutoApproveSeverity } from '@/store/workspaces';
import { markScheduledJobRun, markScheduledJobError } from '@/store/scheduled-jobs';
import { getPreconfig, getDefaultPreconfig } from '@/core/preconfig';
import { getModelsConfig } from '@/config';
import { findProviderFromModel, executeChildSession } from '@capekai/core/compat/jean2';


export async function runScheduledJob(job: ScheduledJob): Promise<void> {
  const preconfig = job.preconfigId
    ? await getPreconfig(job.preconfigId)
    : await getDefaultPreconfig();

  if (!preconfig) {
    throw new Error('No preconfig available for scheduled job execution');
  }

  const config = getModelsConfig();
  const workspace = getWorkspace(job.workspaceId);

  const modelId = preconfig.model || config.defaultModel;
  const providerId =
    preconfig.provider ||
    findProviderFromModel(modelId) ||
    config.defaultProvider;

  // Resolve auto-approve severity: job override takes precedence, then workspace default
  const autoApproveSeverity = job.autoApproveSeverity ?? getWorkspaceAutoApproveSeverity(job.workspaceId);

  // Determine whether to reuse an existing session or create a new one
  let sessionId: string;
  let resumeFromHistory = false;

  if (job.reuseSession && job.lastRunSessionId) {
    const existing = getSession(job.lastRunSessionId);
    if (existing && existing.status === 'active') {
      sessionId = existing.id;
      resumeFromHistory = job.includeHistory;
      console.log(`[scheduler] Reusing session ${sessionId} for job '${job.name}' (history: ${resumeFromHistory})`);
    } else {
      sessionId = randomUUID();
      createSession({
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
    }
  } else {
    sessionId = randomUUID();
    createSession({
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
  }

  // Strip the scheduler tool to prevent recursive scheduling
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

  markScheduledJobRun(job.id, sessionId);

  if (result.error) {
    markScheduledJobError(job.id, result.error);
  }
}
