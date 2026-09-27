import { join } from 'node:path';
import type { Preconfig, Workspace } from '@prokopai/sdk';
import { codexWorkspaceMemory } from './workspace-memory';

export interface CodexInstructionSources {
  listPreconfigs(): Promise<Preconfig[]>;
  getPreconfig(id: string): Promise<Preconfig | null>;
  getAgentDirectory(id: string): Promise<string | null>;
  readAgentMemoryFile(id: string, filename: 'MEMORY.md' | 'USER.md'): Promise<string | null>;
}

/** Mirror the client's workspace default selection, including agent-home workspaces. */
export function defaultCodexPreconfigId(workspace: Workspace, preconfigs: Preconfig[]): string | null {
  const primary = preconfigs.filter(item => item.mode !== 'subagent');
  const selected = workspace.settings.preconfigs?.selectedIds;
  const visible = selected?.length ? primary.filter(item => selected.includes(item.id)) : primary;
  return workspace.settings.preconfigs?.defaultId
    || (workspace.settings.isAgentHome ? workspace.settings.agentId : null)
    || visible[0]?.id || primary[0]?.id || null;
}

export async function codexDeveloperInstructions(
  workspace: Workspace, root: string, preconfig: Preconfig, sources: CodexInstructionSources,
): Promise<string> {
  const sections: string[] = [];
  const agentDir = await sources.getAgentDirectory(preconfig.id);
  if (agentDir) {
    const home = join(agentDir, 'home');
    const memoryPath = join(agentDir, 'MEMORY.md');
    const userPath = join(agentDir, 'USER.md');
    sections.push(`<agent_home>\nHome directory: ${home}\nAgent memory files (when present):\n- ${memoryPath}\n- ${userPath}\nAccess outside the working directory remains subject to Codex sandbox and approvals.\n</agent_home>`);
    const memory = await sources.readAgentMemoryFile(preconfig.id, 'MEMORY.md');
    const user = await sources.readAgentMemoryFile(preconfig.id, 'USER.md');
    if (memory) sections.push(`<agent_memory>\n${memory}\n</agent_memory>`);
    if (user) sections.push(`<agent_user_preferences>\n${user}\n</agent_user_preferences>`);
  }
  if (preconfig.systemPrompt) sections.push(preconfig.systemPrompt);
  sections.push(`<workspace>\nWorking directory: ${root}\n${workspace.additionalPaths.length
    ? `Other project directories registered with this workspace:\n${workspace.additionalPaths.map(path => `- ${path}`).join('\n')}\nAccess to these directories remains subject to Codex sandbox and approvals.\n`
    : ''}</workspace>`);
  const memory = await codexWorkspaceMemory(workspace, root);
  if (memory) sections.push(memory);
  return sections.join('\n\n');
}
