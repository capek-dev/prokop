import { tool, jsonSchema } from 'ai';
import type { PreconfigCapabilities } from '@prokopai/sdk/types';
import {
  getContributedDomainToolPayloads,
  getDomainToolFallback,
  mergeDomainToolVisualization,
  type DomainToolPayload,
} from '@/infrastructure/tools/domain-tool-source';
import type { ToolMap } from '@/harnesses/prokop/execution/tool-builders/types';

/**
 * C5 memory and skills domain tools (agent phase). The pre-C5 builder
 * imported the memory and skills implementations directly; it now consumes
 * the agent-scoped domain payloads through the generic
 * contributed-domain-tool seam (`agent_memory`, `agent_skill_manage`), with
 * the explicitly installed fallbacks covering the unscoped path. The agent
 * directory gate stays here: agent tools build only when an agent directory
 * exists for the session preconfig.
 */
export interface AgentToolsOptions {
  agentDir: string;
  /** Agent-level capability switches. Absent or null means all enabled. */
  capabilities?: PreconfigCapabilities | null;
}

export async function buildAgentTools(options: AgentToolsOptions): Promise<ToolMap> {
  const { agentDir, capabilities } = options;
  const tools: ToolMap = {};

  const scopedDomainPayloads = getContributedDomainToolPayloads();
  const domainPayload = (name: string): DomainToolPayload | null =>
    scopedDomainPayloads === null
      ? getDomainToolFallback(name)
      : scopedDomainPayloads.get(name) ?? null;

  const agentMemoryPayload = domainPayload('agent_memory');
  if (agentMemoryPayload && capabilities?.memory !== false) {
    tools['agent_memory'] = tool({
      description: agentMemoryPayload.description,
      inputSchema: jsonSchema(agentMemoryPayload.inputSchema),
      execute: async (args: Record<string, unknown>) =>
        agentMemoryPayload.execute(args, {
          workspaceId: '',
          sessionId: '',
          ask: async () => {
            throw new Error('Cannot ask user: no broadcast channel available');
          },
          agentDir,
        }).then((result) => mergeDomainToolVisualization(agentMemoryPayload, args, result)),
    });
  }

  const agentSkillManagePayload = domainPayload('agent_skill_manage');
  const agentSkillManageDefinition = capabilities?.skills === false
    ? null
    : await agentSkillManagePayload?.resolveDefinition?.('', {
      agentDir,
    });
  if (agentSkillManagePayload && agentSkillManageDefinition) {
    tools['agent_skill_manage'] = tool({
      description: agentSkillManageDefinition.description,
      inputSchema: jsonSchema(agentSkillManageDefinition.inputSchema),
      execute: async (args: Record<string, unknown>) =>
        agentSkillManagePayload.execute(args, {
          workspaceId: '',
          sessionId: '',
          ask: async () => {
            throw new Error('Cannot ask user: no broadcast channel available');
          },
          agentDir,
        }).then((result) => mergeDomainToolVisualization(agentSkillManagePayload, args, result)),
    });
  }

  return tools;
}
