import type { Tool } from 'ai';
import type { ToolDefinition } from '@capekai/tool';
import { dirname } from 'path';
import { pathToFileURL } from 'url';
import { formatSkillsList, getAvailableSkills, getSkill } from './registry';

export async function buildSkillToolDefinition(workspacePath: string, allowed: string[] | null | undefined, _sessionId: string, agentSkillsDir?: string): Promise<ToolDefinition | null> {
  const skills = await getAvailableSkills(workspacePath, allowed, agentSkillsDir);
  if (skills.length === 0) return null;
  const examples = skills.slice(0, 3).map((skill) => `'${skill.name}'`).join(', ');
  const description = [
    'Load a specialized skill that provides domain-specific instructions and workflows.', '',
    'When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.', '',
    'The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.', '',
    'Tool output includes a `<skill_content name="...">` block with the loaded content.', '',
    'The following skills provide specialized sets of instructions for particular tasks.',
    'Invoke this tool to load a skill when a task matches one of the available skills listed below:', '', formatSkillsList(skills),
  ].join('\n');
  return {
    name: 'skill', description,
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: `The name of the skill from available_skills${examples ? ` (e.g., ${examples}, ...)` : ''}` } }, required: ['name'] },
    outputSchema: { type: 'object', properties: { title: { type: 'string' }, output: { type: 'string' } } }, timeout: 5000,
  };
}

export async function executeSkillTool(name: string, workspacePath: string, allowed: string[] | null | undefined, _sessionId: string, agentSkillsDir?: string): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const available = await getAvailableSkills(workspacePath, allowed, agentSkillsDir);
  if (available.length === 0) return { success: false, error: 'No skills are available for this session.' };
  const skill = await getSkill(name, workspacePath, agentSkillsDir);
  if (!skill) return { success: false, error: `Skill "${name}" not found. Available skills: ${available.map((item) => item.name).join(', ') || 'none'}` };
  if (!(allowed === undefined || allowed === null || allowed.includes(name))) return { success: false, error: `Skill "${name}" is not available for this session.` };
  const directory = dirname(skill.location);
  const output = [`<skill_content name="${skill.name}">`, `# Skill: ${skill.name}`, '', skill.content, '', `Base directory for this skill: ${pathToFileURL(directory).href}`, 'Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.', '</skill_content>'].join('\n');
  return { success: true, result: { title: `Loaded skill: ${skill.name}`, output } };
}

export async function createSkillTool(workspacePath: string, allowed: string[] | null | undefined, sessionId: string, agentSkillsDir?: string): Promise<{ name: string; tool: Tool } | null> {
  const definition = await buildSkillToolDefinition(workspacePath, allowed, sessionId, agentSkillsDir);
  if (!definition) return null;
  const { jsonSchema, tool } = await import('ai');
  return { name: 'skill', tool: tool({ description: definition.description, inputSchema: jsonSchema(definition.inputSchema), execute: async (args: Record<string, unknown>) => executeSkillTool(args.name as string, workspacePath, allowed, sessionId, agentSkillsDir) }) };
}
