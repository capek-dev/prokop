import { executeMemoryTool } from '@capekai/core/hosts';
export { formatMemorySection, loadMemoryFile, MEMORY_CHAR_LIMIT, USER_CHAR_LIMIT } from '@capekai/core/hosts';
import { listDomainToolFallbackDefinitions } from '@capekai/core/tools';
import type { PermissionAsk, PermissionRiskLevel } from '@prokopai/sdk';

/** Keep the Codex bridge on the same definitions and executor as Prokop. */
export const codexMemoryTools = {
  definitions: () => listDomainToolFallbackDefinitions()
    .filter(definition => definition.name === 'memory' || definition.name === 'agent_memory')
    .map(({ name, description, inputSchema }) => ({ type: 'function' as const, name, description, inputSchema })),
  execute: (input: Record<string, unknown>, directory: string, risk: PermissionRiskLevel,
    ask?: (request: PermissionAsk) => Promise<boolean>) => executeMemoryTool(input, directory, risk, ask),
};
