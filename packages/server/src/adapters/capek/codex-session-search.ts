import { executeSessionSearchTool } from '@capekai/core/hosts';
import { listDomainToolFallbackDefinitions } from '@capekai/core/tools';
import type { PermissionAsk, PermissionRiskLevel } from '@prokopai/sdk';

/** Use the same definition and executor as the Prokop session search tool. */
export const codexSessionSearch = {
  definitions: () => listDomainToolFallbackDefinitions()
    .filter(definition => definition.name === 'session_search')
    .map(({ name, description, inputSchema }) => ({ type: 'function' as const, name, description, inputSchema })),
  execute: (input: Record<string, unknown>, workspaceId: string, sessionId: string,
    includeToolResults: boolean, risk: PermissionRiskLevel,
    ask: (request: PermissionAsk) => Promise<boolean>, agentId: string | null) =>
    executeSessionSearchTool(input, workspaceId, sessionId, includeToolResults, risk, ask, agentId),
};
