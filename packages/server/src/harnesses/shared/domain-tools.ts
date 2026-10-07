import { lstat, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { PermissionAsk, PermissionRiskLevel } from '@prokopai/sdk';
import { executeMemoryTool } from '@/harnesses/shared/memory/memory-tool';
import { executeSessionSearchTool } from '@/harnesses/shared/session-search/session-search-tool';
import { executeSkillManageTool } from '@/harnesses/shared/skills/skill-manage-tool';
import { listDomainToolFallbackDefinitions } from '@/infrastructure/tools/domain-tool-source';

export {
  formatMemorySection,
  loadMemoryFile,
  MEMORY_CHAR_LIMIT,
  USER_CHAR_LIMIT,
} from '@/harnesses/shared/memory/registry';

/**
 * Harness-neutral seam over the Capek domain-tool executors. Prokop composes
 * these tools as Capek plugins; the Codex CLI and Claude Code harnesses call
 * the same definitions and executors through their own dynamic-tool wrappers.
 * Only this directory may import @prokopai/runtime, so every harness imports the
 * bridge types and facades from here (S11.2).
 */

export interface MemoryDomainBridge {
  definitions(): Array<{ type: 'function'; name: string; description: string; inputSchema: unknown }>;
  execute(input: Record<string, unknown>, directory: string, risk: PermissionRiskLevel,
    ask?: (request: PermissionAsk) => Promise<boolean>): Promise<{ success: boolean; error?: string; result?: unknown }>;
}

export interface SessionSearchDomainBridge {
  definitions(): Array<{ type: 'function'; name: string; description: string; inputSchema: unknown }>;
  execute(input: Record<string, unknown>, workspaceId: string, sessionId: string,
    includeToolResults: boolean, risk: PermissionRiskLevel,
    ask?: (request: PermissionAsk) => Promise<boolean>, agentId?: string | null):
    Promise<{ success: boolean; error?: string }>;
}

export interface AgentSkillsDomainBridge {
  definitions(): Array<{ type: 'function'; name: string; description: string; inputSchema: unknown }>;
  execute(input: Record<string, unknown>, directory: string): Promise<{
    success: boolean; error?: string; title?: string; action?: string; name?: string;
    description?: string; path?: string; summary?: string;
    skills?: Array<{ name: string; description: string }>;
  }>;
}

// The core manager follows SKILL.md symlinks on update/patch. Reject unsafe
// trees before delegating so a bridge caller cannot write through an existing
// link. Shared by every harness that exposes agent skill management.
export async function safeSkillDirectory(agentDir: string): Promise<boolean> {
  if (!isAbsolute(agentDir)) return false;
  try {
    if (!(await lstat(agentDir)).isDirectory()) return false;
    const root = join(agentDir, 'skills');
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      return false;
    }
    if (!(await lstat(root)).isDirectory()) return false;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) return false;
      if (!entry.isDirectory()) continue;
      const path = join(root, entry.name, 'SKILL.md');
      try { if (!(await lstat(path)).isFile()) return false; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false; }
    }
    return true;
  } catch { return false; }
}

/** Workspace and agent memory over the published Capek executor. */
export const memoryDomainTools: MemoryDomainBridge = {
  definitions: () => listDomainToolFallbackDefinitions()
    .filter(definition => definition.name === 'memory' || definition.name === 'agent_memory')
    .map(({ name, description, inputSchema }) => ({ type: 'function' as const, name, description, inputSchema })),
  execute: (input, directory, risk, ask) => executeMemoryTool(input, directory, risk, ask),
};

/** Session search over the published Capek executor and Prokop search host. */
export const sessionSearchDomainTools: SessionSearchDomainBridge = {
  definitions: () => listDomainToolFallbackDefinitions()
    .filter(definition => definition.name === 'session_search')
    .map(({ name, description, inputSchema }) => ({ type: 'function' as const, name, description, inputSchema })),
  execute: (input, workspaceId, sessionId, includeToolResults, risk, ask, agentId) =>
    executeSessionSearchTool(input, workspaceId, sessionId, includeToolResults, risk, ask, agentId),
};

/** Agent skill management over the published Capek executor; risk-free by contract. */
export const agentSkillsDomainTools: AgentSkillsDomainBridge = {
  definitions: () => listDomainToolFallbackDefinitions()
    .filter(definition => definition.name === 'agent_skill_manage')
    .map(({ name, inputSchema }) => ({ type: 'function' as const, name, inputSchema,
      description: 'List, create, update, patch, or delete skills in the selected agent home. '
        + 'Use list to inspect existing names. Writes affect only this agent, not workspace skills.' })),
  execute: (input, agentDir) => executeSkillManageTool(input, agentDir, 'none'),
};
