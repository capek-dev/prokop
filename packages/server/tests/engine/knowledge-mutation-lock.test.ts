import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addEntry, removeEntry, replaceEntry } from '@/harnesses/shared/memory/registry';
import { executeSkillManageTool } from '@/harnesses/shared/skills/skill-manage-tool';
import { withKnowledgeMutationLock } from '@/infrastructure/filesystem/knowledge-mutation-lock';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'capek-knowledge-lock-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('concurrent memory adds preserve every entry, including first directory creation', async () => {
  const directory = join(root, 'new', 'memory');
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => addEntry(directory, 'memory', `Fact ${i}`)));
  expect(results.every(result => result.success)).toBe(true);
  const content = await readFile(join(directory, 'MEMORY.md'), 'utf8');
  expect(content.split('\n')).toHaveLength(20);
  for (let i = 0; i < 20; i++) expect(content.split('\n')).toContain(`- Fact ${i}`);
});

test('host activation and managed memory changes share the same lock before reads', async () => {
  await addEntry(root, 'memory', 'Before');
  const entered = deferred();
  const release = deferred();
  const holder = withKnowledgeMutationLock(root, async () => {
    entered.resolve();
    await release.promise;
    await writeFile(join(root, 'MEMORY.md'), '- Activated\n- Keep');
  });
  await entered.promise;
  const replace = replaceEntry(root, 'memory', 'Activated', 'Updated');
  const remove = removeEntry(root, 'memory', 'Keep');
  release.resolve();
  await holder;
  expect((await replace).success).toBe(true);
  expect((await remove).success).toBe(true);
  expect(await readFile(join(root, 'MEMORY.md'), 'utf8')).toBe('- Updated');
});

test('skill patches compose without lost updates', async () => {
  await executeSkillManageTool({ action: 'create', name: 'example', description: 'Test', content: 'First\nSecond' }, root, 'none');
  const results = await Promise.all([
    executeSkillManageTool({ action: 'patch', name: 'EXAMPLE', oldString: 'First', newString: 'Changed first' }, root, 'none'),
    executeSkillManageTool({ action: 'patch', name: 'example', oldString: 'Second', newString: 'Changed second' }, root, 'none'),
  ]);
  expect(results.every(result => result.success)).toBe(true);
  const content = await readFile(join(root, 'example', 'SKILL.md'), 'utf8');
  expect(content).toContain('Changed first');
  expect(content).toContain('Changed second');
});

test('skill create and delete honor the host directory lock', async () => {
  const entered = deferred();
  const release = deferred();
  const holder = withKnowledgeMutationLock(root, async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  let completed = false;
  const create = executeSkillManageTool({ action: 'create', name: 'x', description: 'd', content: 'c' }, root, 'none').then(result => { completed = true; return result; });
  await Promise.resolve();
  expect(completed).toBe(false);
  release.resolve();
  await holder;
  expect((await create).success).toBe(true);
  const results = await Promise.all([
    executeSkillManageTool({ action: 'update', name: 'x', content: 'Updated' }, root, 'none'),
    executeSkillManageTool({ action: 'delete', name: 'x' }, root, 'none'),
  ]);
  expect(results.every(result => result.success)).toBe(true);
});

test('permission waits do not hold the mutation lock', async () => {
  const asked = deferred();
  const answer = deferred();
  const waiting = executeSkillManageTool({ action: 'create', name: 'x', description: 'd', content: 'c' }, root, 'high', async () => {
    asked.resolve(); await answer.promise; return false;
  });
  await asked.promise;
  expect(await withKnowledgeMutationLock(root, async () => 'available')).toBe('available');
  answer.resolve();
  expect((await waiting).success).toBe(false);
});

test('directory aliases share a queue, including missing child directories', async () => {
  const directory = join(root, 'real');
  const alias = join(root, 'alias');
  await mkdir(directory);
  await symlink(directory, alias, 'junction');
  const events: string[] = [];
  const release = deferred();
  const entered = deferred();
  const first = withKnowledgeMutationLock(join(directory, 'missing'), async () => {
    events.push('first'); entered.resolve(); await release.promise;
  });
  await entered.promise;
  const second = withKnowledgeMutationLock(join(alias, 'missing'), async () => { events.push('second'); });
  await Promise.resolve();
  expect(events).toEqual(['first']);
  release.resolve();
  await Promise.all([first, second]);
  expect(events).toEqual(['first', 'second']);
});

test('exceptions release queues and nested locks fail instead of deadlocking', async () => {
  await expect(withKnowledgeMutationLock(root, async () => {
    await withKnowledgeMutationLock(root, async () => undefined);
  })).rejects.toThrow('Nested');
  await expect(withKnowledgeMutationLock(root, async () => { throw new Error('failure'); })).rejects.toThrow('failure');
  expect(await withKnowledgeMutationLock(root, async () => 42)).toBe(42);
  await expect(withKnowledgeMutationLock('', async () => undefined)).rejects.toThrow('Invalid');
});

test('independent roots proceed while another root is locked', async () => {
  const release = deferred();
  const entered = deferred();
  const first = withKnowledgeMutationLock(join(root, 'a'), async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  expect(await withKnowledgeMutationLock(join(root, 'b'), async () => 'independent')).toBe('independent');
  release.resolve();
  await first;
});
