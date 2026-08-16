import { join } from 'path';
import type { WorkspaceSettings } from '@jean2/sdk';

/**
 * Agents domain: agent home directory semantics.
 *
 * Owns the layout rules that make a preconfig an agent on disk: the agent
 * directory under `<dataDir>/agents`, the `skills` and `home/.jean2`
 * subdirectories, the `USER.md`/`MEMORY.md` memory files, and the virtual
 * home workspace (`<agentId>-home`) with its fixed settings. These rules
 * were inline in `agents/storage.ts` before S4.
 */

export const AGENT_MEMORY_USER_FILENAME = 'USER.md';
export const AGENT_MEMORY_MEMORY_FILENAME = 'MEMORY.md';

export type AgentMemoryTarget = 'user' | 'memory';

export function agentsRoot(dataDir: string): string {
  return join(dataDir, 'agents');
}

export function agentDirectoryPath(dataDir: string, agentId: string): string {
  return join(agentsRoot(dataDir), agentId);
}

export function agentSkillsDirectoryPath(dataDir: string, agentId: string): string {
  return join(agentDirectoryPath(dataDir, agentId), 'skills');
}

export function agentHomeDirectoryPath(dataDir: string, agentId: string): string {
  return join(agentDirectoryPath(dataDir, agentId), 'home');
}

export function agentHomeDotJean2DirectoryPath(dataDir: string, agentId: string): string {
  return join(agentHomeDirectoryPath(dataDir, agentId), '.jean2');
}

/** The virtual home workspace id derived from the agent id. */
export function agentHomeWorkspaceId(agentId: string): string {
  return `${agentId}-home`;
}

export function agentMemoryFilename(target: AgentMemoryTarget): 'USER.md' | 'MEMORY.md' {
  return target === 'user' ? AGENT_MEMORY_USER_FILENAME : AGENT_MEMORY_MEMORY_FILENAME;
}

/** The exact home workspace settings applied on promotion. Fixed policy:
 * memory, skills, session search, and scheduling are enabled with 'low'
 * permission risk; session search starts without tool results; the
 * workspace is flagged as the agent home. */
export function agentHomeWorkspaceSettings(agentId: string): WorkspaceSettings {
  return {
    isAgentHome: true,
    agentId,
    memory: { enabled: true, permissionRisk: 'low' },
    skills: { managementEnabled: true, permissionRisk: 'low' },
    sessionSearch: { enabled: true, permissionRisk: 'low', includeToolResults: false },
    scheduling: { enabled: true, permissionRisk: 'low' },
  };
}

/** The exact home workspace creation input used on promotion. */
export function buildAgentHomeWorkspaceInput(agentId: string, homePath: string): {
  id: string;
  name: string;
  path: string;
  isVirtual: boolean;
} {
  return {
    id: agentHomeWorkspaceId(agentId),
    name: agentHomeWorkspaceId(agentId),
    path: homePath,
    isVirtual: true,
  };
}
