import { executeSkillManageTool } from '@capekai/core/hosts';
import { listDomainToolFallbackDefinitions } from '@capekai/core/tools';

/** The published Čapek executor owns agent-skill file mutations and locking. */
export const codexAgentSkillTools = {
  definitions: () => listDomainToolFallbackDefinitions()
    .filter(definition => definition.name === 'agent_skill_manage')
    .map(({ name, inputSchema }) => ({ type: 'function' as const, name, inputSchema,
      description: 'List, create, update, patch, or delete skills in the selected agent home. '
        + 'Use list to inspect existing names. Writes affect only this agent, not workspace skills.' })),
  execute: (input: Record<string, unknown>, agentDir: string) =>
    executeSkillManageTool(input, agentDir, 'none'),
};
