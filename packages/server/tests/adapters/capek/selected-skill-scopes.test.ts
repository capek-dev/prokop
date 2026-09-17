import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAvailableSkills } from '@capekai/core/hosts';
import { createRuntime } from '@/bootstrap/create-runtime';

describe('published skill snapshot authorization', () => {
  test('preserves empty/restricted allowlists, workspace precedence and worktree isolation', async () => {
    createRuntime();
    const root = await mkdtemp(join(tmpdir(), 'selected-skills-'));
    try {
      const workspace = join(root, 'workspace');
      const other = join(root, 'other-worktree');
      const agent = join(root, 'agent-skills');
      for (const [directory, name, content] of [
        [join(workspace, '.agents/skills/shared'), 'shared', 'workspace body'],
        [join(agent, 'shared'), 'shared', 'agent shadowed body'],
        [join(agent, 'personal'), 'personal', 'agent body'],
        [join(other, '.agents/skills/other'), 'other', 'other worktree body'],
      ]) {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: procedure\n---\n${content}`);
      }
      expect(await getAvailableSkills(workspace, [], agent)).toEqual([]);
      const restricted = await getAvailableSkills(workspace, ['shared'], agent);
      expect(restricted.map(skill => skill.content)).toEqual(['workspace body']);
      const all = await getAvailableSkills(workspace, null, agent);
      expect(all.map(skill => skill.name).sort()).toEqual(['personal', 'shared']);
      expect(all.some(skill => skill.content === 'other worktree body')).toBe(false);
      expect((await getAvailableSkills(other, ['shared'], agent))[0].content).toBe('agent shadowed body');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
