import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLearningKnowledgeExecutor, type LearningKnowledgeBoundary } from '@/adapters/capek/learning-knowledge';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'learning-public-api-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function fixture(scope: 'workspace' | 'agent' = 'workspace', improveSkills = true) {
  const mutations: string[] = [];
  let allowed = true;
  const boundary: LearningKnowledgeBoundary = {
    scope, improveSkills,
    memoryDirectory: join(root, 'live-memory'),
    skillsDirectory: join(root, 'live-skills'),
    authorize: async () => { if (!allowed) throw new Error('Review revoked'); },
    mutate: async (kind, execute) => {
      mutations.push(kind);
      return execute(join(root, `staging-${kind}`));
    },
  };
  return { executor: createLearningKnowledgeExecutor(boundary), mutations, revoke: () => { allowed = false; } };
}

test('published memory executor writes only to host-selected staging, without permission prompts', async () => {
  const f = fixture();
  const result = await f.executor.execute('memory', { action: 'add', target: 'memory', content: 'Verified lesson', basePath: '/ignored' });
  expect(result.success).toBe(true);
  expect(await readFile(join(root, 'staging-memory', 'MEMORY.md'), 'utf8')).toContain('Verified lesson');
  expect(await Bun.file(join(root, 'live-memory', 'MEMORY.md')).exists()).toBe(false);
  expect(f.mutations).toEqual(['memory']);
});

test('published skill executor preserves create and patch behavior behind staging', async () => {
  const f = fixture();
  expect((await f.executor.execute('skill_manage', { action: 'create', name: 'verified-procedure', description: 'Verified sequence', content: 'Original step' })).success).toBe(true);
  expect((await f.executor.execute('skill_manage', { action: 'patch', name: 'verified-procedure', oldString: 'Original step', newString: 'Improved step' })).success).toBe(true);
  expect(await readFile(join(root, 'staging-skills', 'verified-procedure', 'SKILL.md'), 'utf8')).toContain('Improved step');
  expect(f.mutations).toEqual(['skills', 'skills']);
});

test('list operations use validated staging rather than live directories', async () => {
  const f = fixture();
  await f.executor.execute('memory', { action: 'add', target: 'memory', content: 'Scoped lesson' });
  expect((await f.executor.execute('memory', { action: 'list', target: 'memory' })).success).toBe(true);
  expect((await f.executor.execute('skill_manage', { action: 'list' })).success).toBe(true);
  expect(f.mutations).toEqual(['memory', 'memory', 'skills']);
});

test('scope and optional skills fail closed, including direct calls', async () => {
  const workspace = fixture('workspace', false);
  for (const name of ['agent_memory', 'agent_skill_manage', 'skill_manage', 'shell', 'scheduler']) {
    expect((await workspace.executor.execute(name, { action: 'add', target: 'memory', content: 'No' })).success).toBe(false);
  }
  const agent = fixture('agent');
  expect((await agent.executor.execute('memory', { action: 'list', target: 'memory' })).success).toBe(false);
  expect((await agent.executor.execute('agent_memory', { action: 'add', target: 'memory', content: 'General lesson' })).success).toBe(true);
  expect(workspace.mutations).toEqual([]);
});

test('revocation is checked for reads and writes; malformed input never reaches mutation', async () => {
  const f = fixture();
  for (const input of [null, [], 'add', { action: 'unknown' }, { action: 'add', target: 'other' }]) {
    expect((await f.executor.execute('memory', input)).success).toBe(false);
  }
  expect(f.mutations).toEqual([]);
  f.revoke();
  await expect(f.executor.execute('memory', { action: 'list', target: 'memory' })).rejects.toThrow('revoked');
  await expect(f.executor.execute('memory', { action: 'add', target: 'memory', content: 'No' })).rejects.toThrow('revoked');
});
