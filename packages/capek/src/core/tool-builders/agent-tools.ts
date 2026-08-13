import { tool, jsonSchema } from 'ai';
import { executeMemoryTool, memoryToolDefinition } from '../../memory';
import {
  buildSkillManageToolDescription,
  executeSkillManageTool,
  skillManageToolDefinition,
} from '../../skills';
import { join } from 'path';
import type { ToolMap } from './types';

export interface AgentToolsOptions {
  agentDir: string;
}

export async function buildAgentTools(options: AgentToolsOptions): Promise<ToolMap> {
  const { agentDir } = options;
  const tools: ToolMap = {};

  tools['agent_memory'] = tool({
    description: `Persist your PERSONAL knowledge that travels with you across all workspaces.

Use target="user" for cross-workspace user preferences (how this person likes to work).
Use target="memory" for accumulated work knowledge (lessons, patterns, techniques from any project).

This is YOUR personal memory. It is separate from the workspace memory tool.
- Use "memory" (workspace) for project-specific facts about the current codebase.
- Use "agent_memory" (this tool) for cross-project knowledge that applies everywhere.

Actions:
- list: Read current entries and char usage. Requires target only.
- add: Append a new bullet entry. Requires content.
- replace: Find an entry by oldText substring and replace it.
- remove: Find an entry by oldText substring and remove it.

Character limits: user=1500, memory=2500. Keep entries compact.`,
    inputSchema: jsonSchema(memoryToolDefinition.inputSchema),
    execute: async (args: Record<string, unknown>) => {
      const result = await executeMemoryTool(args, agentDir, 'none');
      if (!result.success) {
        return { error: result.error ?? 'Agent memory operation failed' };
      }
      const r = result.result!;
      return {
        title: r.action === 'list' ? `Agent memory list (${r.target})` : 'Agent memory updated',
        ...r,
      };
    },
  });

  const agentSkillsManageDir = join(agentDir, 'skills');
  const agentSkillManageDescription = await buildSkillManageToolDescription(agentSkillsManageDir);
  tools['agent_skill_manage'] = tool({
    description: agentSkillManageDescription,
    inputSchema: jsonSchema(skillManageToolDefinition.inputSchema),
    execute: async (args: Record<string, unknown>) => {
      const result = await executeSkillManageTool(args, agentSkillsManageDir, 'none');
      if (!result.success) {
        return { error: result.error ?? 'Agent skill management failed' };
      }
      return {
        title: result.title,
        action: result.action,
        name: result.name,
        description: result.description,
        path: result.path,
        summary: result.summary,
        skills: result.skills,
      };
    },
  });

  return tools;
}
