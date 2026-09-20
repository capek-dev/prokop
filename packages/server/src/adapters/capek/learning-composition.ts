import { capekContextAssemblerKey, createAgentScope, createProcessScope, enterAgentScope, type CapekPlugin } from '@capekai/core/composition';
import { getRuntimeHost, runtimeHostValuePlugin } from '@capekai/core/plugins';
import { executeChildSession } from '@capekai/core/providers';
import type { Preconfig } from '@prokopai/sdk';
import { jean2AgentPlugins, jean2ProcessPlugins } from './profile';
import { createLearningToolsPlugins, type LearningToolsOptions } from './learning-tools';

const OMITTED = new Set([
  'prokopai.builtin-tools', 'prokopai.tool-resolver', 'current.runtime-host',
  'current.context-sections', 'current.orchestrator-session',
  'current.session-search-domain', 'current.scheduler-domain', 'current.subagent-domain',
  'current.workflow-domain', 'current.goal-domain', 'current.memory-domain', 'current.skills-domain',
]);

export interface LearningCompositionInput extends LearningToolsOptions {
  workspaceId: string;
  workspacePath: string;
  preconfig: Preconfig;
  systemPrompt: string;
  prompt: string;
  signal: AbortSignal;
}

/** A separate agent scope, not a mutation of the foreground runtime. Its context
 * is host-built and its domain payload map is empty, disabling legacy fallbacks. */
export async function executeLearningComposition(
  input: LearningCompositionInput,
  execute: typeof executeChildSession = executeChildSession,
): Promise<{ error?: string }> {
  input.signal.throwIfAborted();
  const host = getRuntimeHost();
  const isolatedHost = {
    ...host,
    delivery: { emit() {} },
    interaction: {
      ...host.interaction,
      async createPendingAsk(): Promise<string> { throw new Error('Learning cannot request interactive permission'); },
      async matchGrant() { return { matched: false, grant: null }; },
      async createGrantFromOptions() { return null; },
    },
  };
  const context: CapekPlugin = {
    id: 'prokopai.learning-context', scope: 'agent', provides: [capekContextAssemblerKey],
    setup(ctx) {
      ctx.provide(capekContextAssemblerKey, { id: 'prokopai.learning-context', async build() { return input.systemPrompt; } });
    },
  };
  const process = await createProcessScope([...jean2ProcessPlugins()]);
  try {
    const agent = await createAgentScope(process, [
      ...jean2AgentPlugins().filter(plugin => !OMITTED.has(plugin.id)),
      runtimeHostValuePlugin('current.runtime-host', isolatedHost), context,
      ...createLearningToolsPlugins(input),
    ]);
    try {
      return await enterAgentScope(agent, () => execute({
        parentSessionId: input.sessionId, childSessionId: input.sessionId,
        workspaceId: input.workspaceId, workspacePath: input.workspacePath,
        preconfig: {
          ...input.preconfig,
          tools: [input.scope === 'agent' ? 'agent_memory' : 'memory', 'session_search',
            ...(input.scope === 'agent' && input.home ? ['home_files'] : []),
            ...(input.improveSkills ? [input.scope === 'agent' ? 'agent_skill_manage' : 'skill_manage'] : [])],
          canSpawnSubagents: false, allowSelfAsSubagent: false,
        },
        prompt: input.prompt, modelId: input.preconfig.model, providerId: input.preconfig.provider,
        variant: input.preconfig.variant, abortSignal: input.signal, resumeFromHistory: false,
      }));
    } finally { await agent.dispose(); }
  } finally { await process.dispose(); }
}
