import { tool, jsonSchema } from 'ai';
import {
  getContributedDomainToolPayloads,
  getDomainToolFallback,
  mergeDomainToolVisualization,
  type DomainToolPayload,
} from '../../runtime/domain-tool-source';
import type { ToolMap } from './types';

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
}

export async function buildAgentTools(options: AgentToolsOptions): Promise<ToolMap> {
  const { agentDir } = options;
  const tools: ToolMap = {};

  const scopedDomainPayloads = getContributedDomainToolPayloads();
  const domainPayload = (name: string): DomainToolPayload | null =>
    scopedDomainPayloads === null
      ? getDomainToolFallback(name)
      : scopedDomainPayloads.get(name) ?? null;

  const agentMemoryPayload = domainPayload('agent_memory');
  if (agentMemoryPayload) {
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
  const agentSkillManageDefinition = await agentSkillManagePayload?.resolveDefinition?.('', {
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
