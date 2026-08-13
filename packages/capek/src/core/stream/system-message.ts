import type { Preconfig } from '@jean2/sdk';
import {
  buildWorkspaceSystemPrompt,
  formatInstructions,
  getAgentDirectory,
  getMemoryGuidance,
  getSessionSearchGuidance,
  getSkillManageGuidance,
  loadInstructions,
  loadMemoryInstructions,
  readAgentMemoryFile,
} from '../../compat/jean2-dependencies';
import { getWorkspace } from '../../storage/runtime';

export interface SystemMessageOptions {
  preconfig: Preconfig;
  workspacePath?: string;
  workspaceId?: string;
  additionalPaths?: string[];
  selfDelegationAvailable?: boolean;
}

export async function buildSystemMessage(options: SystemMessageOptions): Promise<string> {
  const { preconfig, workspacePath, workspaceId, additionalPaths } = options;

  let systemMessage = preconfig.systemPrompt || '';

  // Inject agent memory layers if this is an agent
  const agentDir = await getAgentDirectory(preconfig.id);
  if (agentDir) {
    const agentUserMemory = await readAgentMemoryFile(preconfig.id, 'USER.md');
    if (agentUserMemory) {
      systemMessage = `<agent_user_preferences>\n${agentUserMemory}\n</agent_user_preferences>\n\n` + systemMessage;
    }
    const agentMemory = await readAgentMemoryFile(preconfig.id, 'MEMORY.md');
    if (agentMemory) {
      systemMessage = `<agent_memory>\n${agentMemory}\n</agent_memory>\n\n` + systemMessage;
    }

    systemMessage = systemMessage + '\n\n' + `You have personal memory and skills that travel with you across all workspaces.

MEMORY:
- Use "memory" (workspace) for facts about THIS project (repo conventions, build commands, project-specific patterns).
- Use "agent_memory" (personal) for cross-project knowledge: reusable patterns, techniques, pitfalls, and user preferences that apply everywhere.
- Save to agent_memory when: you complete a complex multi-step task, the user corrects your approach, you discover a pattern useful beyond this project, or you debug through errors.

SKILLS:
- Use "skill_manage" for procedures specific to THIS workspace.
- Use "agent_skill_manage" for personal workflows you've refined across projects.

Before saving, use list to check existing entries and avoid duplicates.`;
  }

  if (options.selfDelegationAvailable) {
    systemMessage = systemMessage + '\n\n' + `SELF-DELEGATION:
- You may use the task tool with subagent_type "${preconfig.id}" to delegate work to a fresh instance of yourself.
- This permission applies only to the immediate child. Reusing "${preconfig.id}" later in the same ancestry chain is blocked.`;
  }

  // Add instructions (global first, then project)
  const instructions = await loadInstructions(workspacePath);
  const instructionsSection = formatInstructions(instructions);
  if (instructionsSection) {
    systemMessage = systemMessage + '\n\n' + instructionsSection;
  }

  // Add workspace context
  if (workspacePath) {
    const workspaceContext = buildWorkspaceSystemPrompt(workspacePath, additionalPaths);
    systemMessage = systemMessage + '\n\n' + workspaceContext;
  }

  // Add workspace-gated guidance sections
  if (workspaceId) {
    const workspace = getWorkspace(workspaceId);
    if (workspace?.settings?.memory?.enabled && workspacePath) {
      const memorySection = await loadMemoryInstructions(workspacePath);
      if (memorySection) {
        systemMessage = systemMessage + '\n\n' + memorySection;
      }
      systemMessage = systemMessage + '\n\n' + getMemoryGuidance();
    }

    if (workspace?.settings?.skills?.managementEnabled) {
      systemMessage = systemMessage + '\n\n' + getSkillManageGuidance();
    }

    if (workspace?.settings?.sessionSearch?.enabled) {
      systemMessage = systemMessage + '\n\n' + getSessionSearchGuidance();
    }
  }

  return systemMessage;
}
