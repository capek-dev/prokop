import { existsSync } from 'fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import type { PermissionAsk } from '@capekai/tool';
import { PermissionRiskLevel } from '@capekai/tool';
import { scanSkillsFromDir } from './registry';

type SkillManageAction = 'list' | 'create' | 'update' | 'patch' | 'delete';
export interface SkillManageResult {
  success: boolean;
  title?: string;
  action?: SkillManageAction;
  name?: string;
  description?: string;
  path?: string;
  summary?: string;
  skills?: Array<{ name: string; description: string }>;
  error?: string;
}

function sanitizeSkillName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}
function validateSkillName(name: string): string | null {
  if (!name || name.trim().length === 0) return 'Skill name cannot be empty.';
  if (name.includes('/') || name.includes('\\')) return 'Skill name cannot contain path separators.';
  if (name.startsWith('.')) return 'Skill name cannot start with a dot.';
  if (name.includes('..')) return 'Skill name cannot contain "..".';
  return null;
}
const frontmatter = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n`;
const skillDir = (root: string, name: string) => join(root, name);
const skillPath = (root: string, name: string) => join(skillDir(root, name), 'SKILL.md');

async function resolveSkillFolder(rawName: string, root: string): Promise<{ folderName: string; skillMdPath: string } | null> {
  const safeName = sanitizeSkillName(rawName);
  const direct = skillPath(root, safeName);
  if (existsSync(direct)) return { folderName: safeName, skillMdPath: direct };
  if (!existsSync(root)) return null;
  try {
    for (const folder of await readdir(root, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      const path = join(root, folder.name, 'SKILL.md');
      if (!existsSync(path)) continue;
      if (folder.name.toLowerCase() === safeName.toLowerCase()) return { folderName: folder.name, skillMdPath: path };
      try {
        const match = (await readFile(path, 'utf-8')).match(/^---\n([\s\S]*?)\n---\n?/);
        const name = match?.[1].match(/^name:\s*(.+)$/m)?.[1].replace(/^['"]|['"]$/g, '').trim().toLowerCase();
        if (name === safeName.toLowerCase()) return { folderName: folder.name, skillMdPath: path };
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}
async function availableNames(root: string): Promise<string[]> {
  return (await scanSkillsFromDir(root)).map((skill) => skill.name);
}

export async function buildSkillManageToolDescription(root: string): Promise<string> {
  const skills = await scanSkillsFromDir(root);
  const lines = [
    'Create, update, patch, delete, or list workspace skills.', '',
    'Workspace skills are reusable procedures and workflows stored as SKILL.md files in .agents/skills/.', '',
    'Actions:',
    '- list: List all existing skills with their names and descriptions. No other parameters needed.',
    '- create: Create a new skill. Requires name, description, and content (markdown body).',
    '- update: Replace a skill\'s full body and optionally update description. Requires name and content.',
    '- patch: Targeted string replacement in a skill\'s SKILL.md. Requires name, oldString, newString.',
    '- delete: Remove a skill entirely. Requires name only.', '',
    'Skill bodies should be procedural: When to Use, Procedure steps, Pitfalls, Verification.', '',
  ];
  if (skills.length > 0) {
    lines.push('Existing skills in this workspace:');
    for (const skill of skills) lines.push(`- ${skill.name}: ${skill.description}`);
    lines.push('', 'For patch/update, use the exact name shown above. Skill names are matched case-insensitively.');
  } else lines.push('No skills exist yet. Use create to make the first one.');
  return lines.join('\n');
}

export const skillManageToolDefinition = {
  name: 'skill_manage',
  description: `Create, update, patch, or delete workspace skills.

Workspace skills are reusable procedures and workflows stored as SKILL.md files in .agents/skills/.

Actions:
- list: List all existing skills with their names and descriptions. No other parameters needed.
- create: Create a new skill. Requires name, description, and content (markdown body).
- update: Replace a skill's full body and optionally update description. Requires name and content.
- patch: Targeted string replacement in a skill's SKILL.md. Requires name, oldString, newString.
- delete: Remove a skill entirely. Requires name only.

Skill bodies should be procedural: When to Use, Procedure steps, Pitfalls, Verification.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: { type: 'string' as const, enum: ['list', 'create', 'update', 'patch', 'delete'], description: 'The action to perform.' },
      name: { type: 'string' as const, description: 'Skill name (will be normalized to a safe slug). Matched case-insensitively against existing skills.' },
      description: { type: 'string' as const, description: 'Concise trigger/use description for the skill. Required for create. Optional for update/patch.' },
      content: { type: 'string' as const, description: 'Markdown body for create/update actions. Not full frontmatter — just the body.' },
      oldString: { type: 'string' as const, description: 'Exact text to find for patch action. Must match exactly once. Load the skill first to see the exact content.' },
      newString: { type: 'string' as const, description: 'Replacement text for patch action.' },
    },
    required: ['action'],
  },
  timeout: 10000,
};

export async function executeSkillManageTool(input: Record<string, unknown>, root: string, risk: PermissionRiskLevel, askFn?: (ask: PermissionAsk) => Promise<unknown>): Promise<SkillManageResult> {
  const action = input.action as SkillManageAction;
  const rawName = input.name as string;
  const description = input.description as string | undefined;
  const content = input.content as string | undefined;
  const oldString = input.oldString as string | undefined;
  const newString = input.newString as string | undefined;
  if (!['list', 'create', 'update', 'patch', 'delete'].includes(action)) return { success: false, error: 'Invalid action. Must be list, create, update, patch, or delete.' };
  if (action === 'list') {
    const skills = await scanSkillsFromDir(root);
    if (skills.length === 0) return { success: true, title: 'No skills found', action: 'list', summary: 'No skills exist in this workspace yet.', skills: [] };
    return { success: true, title: `${skills.length} skill${skills.length === 1 ? '' : 's'} found`, action: 'list', summary: skills.map((skill) => `${skill.name}: ${skill.description}`).join('\n'), skills: skills.map(({ name, description: value }) => ({ name, description: value })) };
  }
  if (typeof rawName !== 'string') return { success: false, error: 'Skill name cannot be empty.' };
  if (description !== undefined && typeof description !== 'string') return { success: false, error: 'description must be a string.' };
  if (content !== undefined && typeof content !== 'string') return { success: false, error: 'content must be a string.' };
  if (oldString !== undefined && typeof oldString !== 'string') return { success: false, error: 'oldString must be a string.' };
  if (newString !== undefined && typeof newString !== 'string') return { success: false, error: 'newString must be a string.' };
  const nameError = validateSkillName(rawName);
  if (nameError) return { success: false, error: nameError };
  const safeName = sanitizeSkillName(rawName);
  if (!safeName) return { success: false, error: 'Skill name is invalid after normalization.' };
  if (risk !== 'none' && askFn) {
    const approved = await askFn({ type: 'permission', question: `Allow skill ${action}: ${safeName}?`, description: `Action: ${action}\nSkill: ${safeName}${description ? `\nDescription: ${description.slice(0, 200)}` : ''}${content ? `\nContent: ${content.slice(0, 200)}` : ''}`, risk, resource: 'file', action: 'write', paths: [`${safeName}/SKILL.md`] });
    if (!approved) return { success: false, error: 'USER_REJECTION' };
  }

  if (action === 'create') {
    if (!description) return { success: false, error: 'description is required for create action.' };
    if (!content) return { success: false, error: 'content is required for create action.' };
    const path = skillPath(root, safeName);
    if (existsSync(path)) return { success: false, error: `Skill "${safeName}" already exists. Use update or patch instead.` };
    await mkdir(skillDir(root, safeName), { recursive: true });
    await writeFile(path, frontmatter(safeName, description) + '\n' + content + '\n', 'utf-8');
    return { success: true, title: `Skill created: ${safeName}`, action, name: safeName, description, path: `${safeName}/SKILL.md`, summary: 'Created workspace skill.' };
  }

  const resolved = await resolveSkillFolder(rawName, root);
  if (!resolved) {
    const names = await availableNames(root);
    return { success: false, error: `Skill "${rawName}" does not exist.${names.length ? ` Available skills: ${names.join(', ')}` : action === 'delete' ? '' : ' No skills exist yet. Use create first.'}` };
  }
  const relativePath = `${resolved.folderName}/SKILL.md`;
  if (action === 'delete') {
    await rm(skillDir(root, resolved.folderName), { recursive: true, force: true });
    return { success: true, title: `Skill deleted: ${resolved.folderName}`, action, name: resolved.folderName, path: relativePath, summary: 'Removed workspace skill directory.' };
  }
  let existing: string;
  try { existing = await readFile(resolved.skillMdPath, 'utf-8'); } catch { return { success: false, error: 'Failed to read existing skill file.' }; }

  if (action === 'update') {
    if (!content) return { success: false, error: 'content is required for update action.' };
    const existingDescription = existing.match(/^description:\s*(.+)$/m)?.[1].replace(/^['"]|['"]$/g, '') ?? '';
    const existingName = existing.match(/^name:\s*(.+)$/m)?.[1].replace(/^['"]|['"]$/g, '').trim() ?? resolved.folderName;
    const effectiveDescription = description ?? existingDescription;
    await writeFile(resolved.skillMdPath, frontmatter(existingName, effectiveDescription) + '\n' + content + '\n', 'utf-8');
    return { success: true, title: `Skill updated: ${existingName}`, action, name: existingName, description: effectiveDescription, path: relativePath, summary: 'Replaced skill body.' };
  }

  if (!oldString) return { success: false, error: 'oldString is required for patch action.' };
  if (newString === undefined || newString === null) return { success: false, error: 'newString is required for patch action.' };
  const matches = existing.split(oldString).length - 1;
  if (matches === 0) return { success: false, error: 'oldString not found in skill file. Load the skill via the "skill" tool first to see the exact content, then copy the exact text to oldString.' };
  if (matches > 1) return { success: false, error: `oldString matched ${matches} locations. Provide a more specific oldString.` };
  let patched = existing.replace(oldString, newString);
  if (description) patched = patched.replace(/^(description:\s*).*$/m, `$1${description}`);
  await writeFile(resolved.skillMdPath, patched, 'utf-8');
  const resultName = patched.match(/^name:\s*(.+)$/m)?.[1].replace(/^['"]|['"]$/g, '').trim() ?? resolved.folderName;
  const resultDescription = description ?? patched.match(/^description:\s*(.+)$/m)?.[1].replace(/^['"]|['"]$/g, '');
  return { success: true, title: `Skill patched: ${resultName}`, action, name: resultName, description: resultDescription, path: relativePath, summary: 'Replaced one matching block.' };
}

export const SKILL_MANAGE_GUIDANCE = `You can create and update workspace skills using the skill_manage tool.
Workspace skills are reusable procedures/workflows stored under .agents/skills in the current workspace.

Use memory for compact durable facts.
Use skill_manage for repeatable multi-step procedures, debugging workflows, conventions, and verification steps that are too procedural for MEMORY.md.

When to create or update a skill:
- After completing a complex reusable workflow.
- After debugging through errors and discovering the working path.
- When the user corrects your approach in a way that should affect future similar tasks.
- When you discover workspace-specific procedures, pitfalls, commands, or verification steps.

When not to create a skill:
- For one-off facts or temporary context.
- For secrets, credentials, raw logs, or large code dumps.
- For obvious information already present in AGENTS.md or an existing skill.

Before creating a new skill, consider whether an existing skill should be patched instead.
Prefer patch over update for small changes.
Keep skill descriptions concise and trigger-focused because descriptions are used to decide when to load a skill.
Keep skill bodies procedural and verification-oriented.`;
