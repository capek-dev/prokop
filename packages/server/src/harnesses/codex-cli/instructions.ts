import { join } from 'node:path';
import type { Preconfig, Workspace } from '@prokopai/sdk';
import { formatCodexAgentSkills, listCodexAgentSkills } from './agent-skills';
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

// Match Prokop's memory guidance without advertising its unavailable skill tools.
function agentMemoryGuidance(workspaceMemoryAvailable: boolean): string {
  return `You have personal memory that travels with you across all workspaces.

MEMORY:
${workspaceMemoryAvailable ? '- Use "memory" (workspace) for facts about THIS project (repo conventions, build commands, project-specific patterns).\n' : ''}- Use "agent_memory" (personal) for cross-project knowledge: reusable patterns, techniques, pitfalls, and user preferences that apply everywhere.
- Save to agent_memory when: you complete a complex multi-step task, the user corrects your approach, you discover a pattern useful beyond this project, or you debug through errors.

Before saving, use list to check existing entries and avoid duplicates.`;
}

const WORKSPACE_MEMORY_GUIDANCE = `You can persist durable workspace knowledge using the memory tool.
Use target="user" for user preferences and communication/workflow expectations.
Use target="memory" for workspace facts, repo conventions, commands, lessons, and non-obvious fixes.
Character limits: user=1500, workspace=2500.
Only save compact facts that should affect future sessions.
Do not save secrets, raw logs, large code, or one-off details.
If memory is full, consolidate existing entries with replace before adding.
Use the list action to verify current entries before replacing or removing.`;

export async function codexDeveloperInstructions(
  workspace: Workspace, root: string, preconfig: Preconfig, sources: CodexInstructionSources,
  availableTools: readonly string[] = [],
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
    if (availableTools.includes('agent_memory')) {
      sections.push(agentMemoryGuidance(availableTools.includes('memory')));
    }
    const skillList = formatCodexAgentSkills(await listCodexAgentSkills(agentDir, root, preconfig.skills));
    if (skillList) sections.push(skillList);
    if (availableTools.includes('agent_skill_manage')) {
      sections.push('Use agent_skill_manage to list or maintain skills in the selected agent home. It does not manage workspace skills.');
    }
  }
  if (preconfig.systemPrompt) sections.push(preconfig.systemPrompt);
  sections.push(`<workspace>\nWorking directory: ${root}\n${workspace.additionalPaths.length
    ? `Other project directories registered with this workspace:\n${workspace.additionalPaths.map(path => `- ${path}`).join('\n')}\nAccess to these directories remains subject to Codex sandbox and approvals.\n`
    : ''}</workspace>`);
  const memory = await codexWorkspaceMemory(workspace, root);
  if (memory) sections.push(memory);
  if (workspace.settings.memory?.enabled === true && availableTools.includes('memory')) {
    sections.push(WORKSPACE_MEMORY_GUIDANCE);
  }
  if (workspace.settings.sessionSearch?.enabled === true && availableTools.includes('session_search')) {
    sections.push(`Use session_search to recall past conversations when earlier work or context matters.
List recent sessions to find an ID, search by keywords, and read the relevant messages before drawing conclusions.
Prefer current_session for this conversation and workspace for other sessions in this project.
Use agent scope only for the selected agent's cross-workspace history.`);
  }
  return sections.join('\n\n');
}
