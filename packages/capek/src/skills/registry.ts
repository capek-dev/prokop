import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { getHostLayout } from '../runtime/host-layout';
import type { SkillInfo } from '@capekai/types';

function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content: raw };
  const frontmatter: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) frontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return { frontmatter, content: match[2] };
}

export async function scanSkillsDir(skillsDir: string): Promise<SkillInfo[]> {
  if (!existsSync(skillsDir)) return [];
  const skills: SkillInfo[] = [];
  try {
    for (const folder of await readdir(skillsDir, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      const location = join(skillsDir, folder.name, 'SKILL.md');
      try {
        if (!existsSync(location)) continue;
        const { frontmatter, content } = parseFrontmatter(await readFile(location, 'utf-8'));
        if (!frontmatter.name || !frontmatter.description) {
          console.warn(`Invalid SKILL.md in ${folder.name}: missing name or description`);
          continue;
        }
        skills.push({ name: frontmatter.name as string, description: frontmatter.description as string, location, content: content.trim(), userInvocable: frontmatter['user-invocable'] !== false });
      } catch (error: unknown) {
        console.warn(`Failed to read SKILL.md in ${folder.name}:`, error);
      }
    }
  } catch (error: unknown) {
    console.error('Failed to scan skills directory:', error);
  }
  return skills;
}
export const scanSkillsFromDir = scanSkillsDir;
export async function scanSkills(workspacePath: string, agentSkillsDir?: string): Promise<SkillInfo[]> {
  const skills = await scanSkillsDir(getHostLayout().workspaceSkillsDir(workspacePath));
  if (agentSkillsDir) {
    const names = new Set(skills.map((skill) => skill.name));
    for (const skill of await scanSkillsDir(agentSkillsDir)) if (!names.has(skill.name)) skills.push(skill);
  }
  return skills;
}
export async function getSkill(name: string, workspacePath: string, agentSkillsDir?: string): Promise<SkillInfo | null> {
  return (await scanSkills(workspacePath, agentSkillsDir)).find((skill) => skill.name === name) ?? null;
}
export const listSkills = scanSkills;
export async function getAvailableSkills(workspacePath: string, allowed: string[] | null | undefined, agentSkillsDir?: string): Promise<SkillInfo[]> {
  const all = await scanSkills(workspacePath, agentSkillsDir);
  if (allowed === undefined || allowed === null) return all;
  if (allowed.length === 0) return [];
  return all.filter((skill) => allowed.includes(skill.name));
}
export function formatSkillsList(skills: SkillInfo[]): string {
  return skills.length === 0 ? 'No skills are currently available.' : skills.map((skill) => `- **${skill.name}**: ${skill.description}`).join('\n');
}
