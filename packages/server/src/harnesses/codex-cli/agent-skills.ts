import { lstat, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

interface SkillListing { name: string; description: string; path: string }

/** Prokop's SKILL.md metadata format, limited to the selected agent's home. */
async function scan(root: string): Promise<SkillListing[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const skills: SkillListing[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name, 'SKILL.md');
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size > 128_000) continue;
      const raw = await readFile(path, 'utf8');
      const block = /^---\n([\s\S]*?)\n---\n?/.exec(raw)?.[1];
      if (!block) continue;
      const fields = new Map(block.split('\n').map(line => {
        const colon = line.indexOf(':');
        return colon > 0 ? [line.slice(0, colon).trim(), line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')] : ['', ''];
      }));
      const name = fields.get('name')?.trim();
      const description = fields.get('description')?.trim();
      if (name && description && !/[\r\n<>]/.test(name) && !/[\r\n<>]/.test(description)) {
        skills.push({ name, description, path });
      }
    } catch { /* A removed or invalid skill is not advertised. */ }
  }
  return skills;
}

/** Workspace skills win collisions; an empty allowlist means no readable skills. */
export async function listCodexAgentSkills(agentDir: string | null, workspaceRoot: string,
  allowed: string[] | null | undefined): Promise<SkillListing[]> {
  if (!agentDir || !isAbsolute(agentDir) || !isAbsolute(workspaceRoot) || allowed?.length === 0) return [];
  const workspaceNames = new Set((await scan(join(workspaceRoot, '.agents', 'skills'))).map(skill => skill.name));
  const names = new Set<string>();
  return (await scan(join(agentDir, 'skills'))).filter(skill => {
    if (workspaceNames.has(skill.name) || names.has(skill.name)
      || allowed && !allowed.includes(skill.name)) return false;
    names.add(skill.name);
    return true;
  });
}

export function formatCodexAgentSkills(skills: SkillListing[]): string | null {
  if (!skills.length) return null;
  const lines = ['<agent_home_skills>',
    'The selected agent has these skills. When one matches the task, read its SKILL.md before following it.',
    'These paths are not sandbox grants. If a read is denied, do not assume the skill was loaded.'];
  let size = lines.join('\n').length;
  let count = 0;
  for (const skill of skills) {
    const line = `- ${skill.name}: ${skill.description} (${skill.path})`;
    if (size + line.length + '</agent_home_skills>'.length + 2 > 8_000) continue;
    lines.push(line);
    size += line.length + 1;
    count++;
  }
  if (!count) return null;
  lines.push('</agent_home_skills>');
  return lines.join('\n');
}
