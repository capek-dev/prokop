import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm, mkdir, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addEntry } from '@capekai/core/hosts';
import { createLearningKnowledgeFiles } from '@/infrastructure/filesystem/learning-knowledge';
import { createAgentDirectoryPort } from '@/infrastructure/agents/agent-directory-filesystem';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(await realpath(tmpdir()), 'learning-files-test-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function files(authorize = async () => {}) {
  return createLearningKnowledgeFiles({ memoryDirectory: join(root, 'memory'), skillsDirectory: join(root, 'skills'), authorize });
}

test('published core mutations and host activation serialize without losing foreground content', async () => {
  const f = files();
  await f.compareAndSwap('memory/MEMORY.md', null, '- First');
  const [activated, added] = await Promise.all([
    f.compareAndSwap('memory/MEMORY.md', '- First', '- Activated'),
    addEntry(join(root, 'memory'), 'memory', 'Foreground'),
  ]);
  expect(activated).toBe(true);
  expect(added.success).toBe(true);
  expect(await f.read('memory/MEMORY.md')).toBe('- Activated\n- Foreground');
  expect(await f.compareAndSwap('memory/MEMORY.md', '- Activated', 'Stale')).toBe(false);
});

test('agent memory API writes wait for learning activation to release the shared lock', async () => {
  await files().compareAndSwap('memory/MEMORY.md', null, 'Before');
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let first = true;
  const locked = files(async () => {
    if (first) { first = false; entered.resolve(); await release.promise; }
  });
  const activation = locked.compareAndSwap('memory/MEMORY.md', 'Before', 'Learned');
  await entered.promise;
  const foreground = createAgentDirectoryPort().writeFile(join(root, 'memory/MEMORY.md'), 'User replacement');
  release.resolve();
  expect(await activation).toBe(true);
  await foreground;
  expect(await files().read('memory/MEMORY.md')).toBe('User replacement');
});

test('deletion rechecks authorization before removing knowledge', async () => {
  await files().compareAndSwap('memory/MEMORY.md', null, 'Keep');
  let checks = 0;
  const guarded = files(async () => { if (++checks === 2) throw new Error('Revoked'); });
  await expect(guarded.compareAndSwap('memory/MEMORY.md', 'Keep', null)).rejects.toThrow('Revoked');
  expect(await files().read('memory/MEMORY.md')).toBe('Keep');
});

test('staging is isolated and preserves skill auxiliary files on deletion', async () => {
  const f = files();
  await f.compareAndSwap('skills/example/SKILL.md', null, 'Skill');
  await writeFile(join(root, 'skills/example/reference.txt'), 'Reference');
  const stage = await f.create('skills', await f.snapshot('skills'));
  try {
    expect(await readFile(join(stage.directory, 'example/SKILL.md'), 'utf8')).toBe('Skill');
    await writeFile(join(stage.directory, 'example/SKILL.md'), 'Staged');
    expect(await f.read('skills/example/SKILL.md')).toBe('Skill');
  } finally { await stage.dispose(); }
  expect(await f.compareAndSwap('skills/example/SKILL.md', 'Skill', null)).toBe(true);
  expect(await readFile(join(root, 'skills/example/reference.txt'), 'utf8')).toBe('Reference');
});

test('rejects path escapes, symlinks and revoked operations', async () => {
  const f = files();
  await expect(f.compareAndSwap('memory/../code.ts', null, 'No')).rejects.toThrow();
  await mkdir(join(root, 'memory'));
  await writeFile(join(root, 'outside'), 'Secret');
  await symlink(join(root, 'outside'), join(root, 'memory/MEMORY.md'));
  await expect(f.read('memory/MEMORY.md')).rejects.toThrow('symlinks');
  await expect(f.compareAndSwap('memory/MEMORY.md', 'Secret', 'No')).rejects.toThrow('symlinks');
  await expect(files(async () => { throw new Error('Revoked'); }).snapshot('skills')).rejects.toThrow('Revoked');
});
