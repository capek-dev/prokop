import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, symlink, link, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLearningHomeTool } from '@/adapters/capek/learning-home';
import { createLearningKnowledgeFiles } from '@/infrastructure/filesystem/learning-knowledge';

let root: string;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  root = await mkdtemp(join(await realpath(tmpdir()), 'learning-home-'));
  let revoked = false;
  const authorize = async () => { if (revoked) throw new Error('Revoked'); };
  const files = createLearningKnowledgeFiles({ memoryDirectory: join(root, 'memory'), skillsDirectory: join(root, 'skills'), homeDirectory: root, authorize });
  const tool = createLearningHomeTool({ root, files, authorize, apply: async (path, before, after) => await files.compareAndSwap(path, before, after) ? 'applied' : 'conflict' });
  return { files, tool, revoke: () => { revoked = true; } };
}

test('home reads and revision-checked writes and deletes work outside notes', async () => {
  const { tool, files } = await fixture();
  expect((await tool({ action: 'write', path: 'snippets/retry.ts', content: 'reference example', revision: null })).success).toBe(true);
  expect(JSON.stringify(await tool({ action: 'list' }))).toContain('snippets/retry.ts');
  expect(JSON.stringify(await tool({ action: 'search', query: 'example' }))).toContain('reference example');
  const read = await tool({ action: 'read', path: 'snippets/retry.ts' });
  const revision = (read.result as { revision: string }).revision;
  expect((await tool({ action: 'write', path: 'snippets/retry.ts', content: 'updated', revision })).success).toBe(true);
  expect((await tool({ action: 'delete', path: 'snippets/retry.ts', revision })).success).toBe(false);
  const updated = await tool({ action: 'read', path: 'snippets/retry.ts' });
  expect((await tool({ action: 'delete', path: 'snippets/retry.ts', revision: (updated.result as { revision: string }).revision })).success).toBe(true);
  expect(await files.read('home/snippets/retry.ts')).toBeNull();
});

test('protected paths, links, binary files and malformed operations fail closed', async () => {
  const { tool, files, revoke } = await fixture();
  for (const path of ['../escape', '/outside', '.env', '.prokopai/MEMORY.md', 'credentials/token.txt', 'key.pem', 'C:/outside', 'a/../b']) {
    expect((await tool({ action: 'write', path, content: 'bad', revision: null })).success).toBe(false);
    await expect(files.compareAndSwap(`home/${path}`, null, 'bad')).rejects.toThrow();
  }
  await writeFile(join(root, 'original'), 'data');
  await symlink(join(root, 'original'), join(root, 'sym'));
  await link(join(root, 'original'), join(root, 'hard'));
  await writeFile(join(root, 'binary'), Buffer.from([0, 255]));
  for (const path of ['sym', 'hard', 'binary']) expect((await tool({ action: 'read', path })).success).toBe(false);
  expect((await tool({ action: 'delete', path: 'original' })).success).toBe(false);
  expect((await tool({ action: 'shell', path: 'original' })).success).toBe(false);
  revoke();
  expect((await tool({ action: 'list' })).success).toBe(false);
});

test('discovery is bounded and can be narrowed to another home directory', async () => {
  const { tool } = await fixture();
  await mkdir(join(root, 'references'));
  for (let i = 0; i < 210; i++) await writeFile(join(root, `file-${i}.txt`), 'data');
  await writeFile(join(root, 'references/detail.md'), 'detail');
  expect((await tool({ action: 'list' })).result).toMatchObject({ truncated: true });
  expect((await tool({ action: 'list', path: 'references' })).result).toEqual({ paths: ['references/detail.md'], truncated: false });
});
