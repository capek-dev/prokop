import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { executeMemoryTool, MEMORY_CHAR_LIMIT, USER_CHAR_LIMIT } from '../src/memory';
import { executeSkillManageTool, executeSkillTool, scanSkills } from '../src/skills';

const root = join(process.cwd(), '.tmp-capek-memory-skills');

beforeEach(async () => { await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true }); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('memory provider', () => {
  test('preserves limits, duplicate rejection, read-only list, and ask denial', async () => {
    let asks = 0;
    const ask = async () => { asks += 1; return false; };
    expect(USER_CHAR_LIMIT).toBe(1500);
    expect(MEMORY_CHAR_LIMIT).toBe(2500);
    expect((await executeMemoryTool({ action: 'list', target: 'memory' }, root, 'high', ask)).success).toBe(true);
    expect(asks).toBe(0);
    expect(await executeMemoryTool({ action: 'add', target: 'memory', content: 'fact' }, root, 'high', ask)).toEqual({ success: false, error: 'USER_REJECTION' });
    expect(asks).toBe(1);
    expect((await executeMemoryTool({ action: 'add', target: 'memory', content: 'fact' }, root, 'none')).success).toBe(true);
    expect((await executeMemoryTool({ action: 'add', target: 'memory', content: 'fact' }, root, 'none')).error).toBe('Exact duplicate entry already exists.');
  });

  test('rejects malformed values and preserves non-entry content on removal', async () => {
    expect((await executeMemoryTool({ action: 'add', target: 'memory', content: 42 }, root, 'none')).success).toBe(false);
    await writeFile(join(root, 'MEMORY.md'), '# Notes\n\n- keep\n- remove me\n\nFooter');
    expect((await executeMemoryTool({ action: 'remove', target: 'memory', oldText: 'remove me' }, root, 'none')).success).toBe(true);
    const content = await readFile(join(root, 'MEMORY.md'), 'utf-8');
    expect(content).toContain('# Notes');
    expect(content).toContain('- keep');
    expect(content).toContain('Footer');
    expect(content).not.toContain('remove me');
  });
});

describe('skills provider', () => {
  test('preserves workspace precedence, wrapping, SKILL.md rules, and case-insensitive management', async () => {
    const workspace = join(root, 'workspace');
    const agent = join(root, 'agent-skills');
    await mkdir(join(workspace, '.agents', 'skills', 'shared'), { recursive: true });
    await mkdir(join(agent, 'shared'), { recursive: true });
    await writeFile(join(workspace, '.agents', 'skills', 'shared', 'SKILL.md'), '---\nname: shared\ndescription: Workspace\n---\nworkspace body');
    await writeFile(join(agent, 'shared', 'SKILL.md'), '---\nname: shared\ndescription: Agent\n---\nagent body');
    const skills = await scanSkills(workspace, agent);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe('Workspace');
    const loaded = await executeSkillTool('shared', workspace, null, 'session', agent);
    expect(loaded.result).toMatchObject({ title: 'Loaded skill: shared' });
    expect((loaded.result as { output: string }).output).toContain('<skill_content name="shared">');

    const managed = join(root, 'managed');
    await executeSkillManageTool({ action: 'create', name: 'My Skill', description: 'desc', content: 'old body' }, managed, 'none');
    const patched = await executeSkillManageTool({ action: 'patch', name: 'MY-SKILL', oldString: 'old body', newString: 'new body' }, managed, 'none');
    expect(patched.success).toBe(true);
    expect(patched.path).toBe('my-skill/SKILL.md');
  });

  test('keeps list read-only and mutation ask-gated', async () => {
    let asks = 0;
    const ask = async () => { asks += 1; return false; };
    expect((await executeSkillManageTool({ action: 'list' }, root, 'high', ask)).success).toBe(true);
    expect(asks).toBe(0);
    expect(await executeSkillManageTool({ action: 'create', name: 'x', description: 'd', content: 'c' }, root, 'high', ask)).toEqual({ success: false, error: 'USER_REJECTION' });
    expect((await executeSkillManageTool({ action: 'create', name: 42, description: 'd', content: 'c' }, root, 'none')).success).toBe(false);
  });
});
