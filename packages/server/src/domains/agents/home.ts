import { existsSync } from 'fs';
import { join } from 'path';
import type { WorkspaceSettings } from '@prokopai/sdk';

/**
 * Agents domain: agent home directory semantics.
 *
 * Owns the layout rules that make a preconfig an agent on disk: the agent
 * directory under `<dataDir>/agents`, the `skills` and `home/.prokopai`
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

export function agentHomeDotDirectoryPath(dataDir: string, agentId: string): string {
  return join(agentHomeDirectoryPath(dataDir, agentId), '.prokopai');
}

/**
 * Legacy alias kept for compatibility (name predates the prokopai rename).
 * Same resolution: the `.prokopai` dir inside the agent home, falling back
 * to `.jean2` when only the legacy dir exists on disk.
 */
export function agentHomeDotJean2DirectoryPath(dataDir: string, agentId: string): string {
  const canonical = agentHomeDotDirectoryPath(dataDir, agentId);
  if (existsSync(canonical)) {
    return canonical;
  }
  const legacy = join(agentHomeDirectoryPath(dataDir, agentId), '.jean2');
  if (existsSync(legacy)) {
    return legacy;
  }
  return canonical;
}

/** The virtual home workspace id derived from the agent id. */
export function agentHomeWorkspaceId(agentId: string): string {
  return `${agentId}-home`;
}

export function agentMemoryFilename(target: AgentMemoryTarget): 'USER.md' | 'MEMORY.md' {
  return target === 'user' ? AGENT_MEMORY_USER_FILENAME : AGENT_MEMORY_MEMORY_FILENAME;
}

/** The exact home workspace settings applied on materialization. The home
 * is only where the agent's own sessions live: memory/skills belong to the
 * agent-scoped tools (workspace surfaces are suppressed in homes by
 * read-time normalization) and session search is always on, so no
 * capability values are seeded here. */
export function agentHomeWorkspaceSettings(agentId: string): WorkspaceSettings {
  return {
    isAgentHome: true,
    agentId,
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
