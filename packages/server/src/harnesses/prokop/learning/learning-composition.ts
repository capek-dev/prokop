import { capekContextAssemblerKey } from '@/harnesses/prokop/composition/plugins/service-keys';
import {
  createAgentScope,
  createProcessScope,
  enterAgentScope,
  type RuntimePlugin,
} from '@/harnesses/prokop/composition/plugins/compose';
import { getRuntimeHost } from '@/infrastructure/runtime/host';
import { runtimeHostValuePlugin } from '@/harnesses/prokop/composition/plugins/value-plugins';
import { executeChildSession } from '@/harnesses/prokop/subagent/child-session';
import type { Preconfig } from '@prokopai/sdk';
import { prokopAgentPlugins, prokopProcessPlugins } from '@/harnesses/prokop/composition/profile';
import { createLearningToolsPlugins, type LearningToolsOptions } from './learning-tools';

const OMITTED = new Set([
  'prokopai.builtin-tools', 'prokopai.tool-resolver', 'current.runtime-host',
  'current.context-sections', 'current.orchestrator-session',
  'current.session-search-domain', 'current.scheduler-domain', 'current.subagent-domain',
  'current.goal-domain', 'current.memory-domain', 'current.skills-domain',
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
  const context: RuntimePlugin = {
    id: 'prokopai.learning-context', scope: 'agent', provides: [capekContextAssemblerKey],
    setup(ctx) {
      ctx.provide(capekContextAssemblerKey, { id: 'prokopai.learning-context', async build() { return input.systemPrompt; } });
    },
  };
  const process = await createProcessScope([...prokopProcessPlugins()]);
  try {
    const agent = await createAgentScope(process, [
      ...prokopAgentPlugins().filter(plugin => !OMITTED.has(plugin.id)),
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
