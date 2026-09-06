import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, removeGitStagedAddition } from '../../../src/infrastructure/filesystem/git-operations';
import { getGitStatus } from '../../../src/infrastructure/filesystem/git-status';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'git-unstage-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Test']);
  await git(root, ['config', 'user.email', 'test@example.invalid']);
  await git(root, ['config', 'commit.gpgsign', 'false']);
  await git(root, ['config', 'core.hooksPath', join(root, 'no-hooks')]);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test.each([false, true])('removes staged then deleted file with existing HEAD=%s', async (existingHead) => {
  if (existingHead) {
    await writeFile(join(root, 'base'), 'base');
    await git(root, ['add', 'base']);
    await git(root, ['commit', '-m', 'base']);
  }
  await writeFile(join(root, 'new'), 'new');
  await git(root, ['add', 'new']);
  await rm(join(root, 'new'));
  expect((await getGitStatus(root)).files.get('new')).toMatchObject({ status: 'deleted', stagedAddition: true });
  await removeGitStagedAddition(root, 'new');
  expect((await getGitStatus(root)).files.has('new')).toBe(false);
  expect((await git(root, ['status', '--porcelain'])).stdout).toBe('');
});
test('keeps current disk contents and unrelated staging, treating paths literally', async () => {
  const path = 'new[1]\nfile';
  await writeFile(join(root, path), 'staged');
  await writeFile(join(root, 'other'), 'other staged');
  await git(root, ['add', '--', path, 'other']);
  await writeFile(join(root, path), 'current');
  await removeGitStagedAddition(root, path);
  expect(await readFile(join(root, path), 'utf8')).toBe('current');
  expect((await git(root, ['ls-files', '-z'])).stdout).toBe('other\0');
  expect((await getGitStatus(root)).files.get(path)?.status).toBe('untracked');
});
test('rejects committed files, traversal and lock contention without changing the index', async () => {
  await writeFile(join(root, 'base'), 'base');
  await git(root, ['add', 'base']);
  await git(root, ['commit', '-m', 'base']);
  await rm(join(root, 'base'));
  const index = await readFile(join(root, '.git/index'));
  await expect(removeGitStagedAddition(root, 'base')).rejects.toThrow('exists in HEAD');
  await expect(removeGitStagedAddition(root, '../bad')).rejects.toThrow('invalid file path');
  expect(await readFile(join(root, '.git/index'))).toEqual(index);
  await writeFile(join(root, '.git/index.lock'), 'busy');
  await expect(removeGitStagedAddition(root, 'base')).rejects.toThrow('index is locked');
  expect(await readFile(join(root, '.git/index.lock'), 'utf8')).toBe('busy');
});
