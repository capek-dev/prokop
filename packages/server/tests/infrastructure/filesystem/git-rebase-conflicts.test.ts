import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../../../src/infrastructure/filesystem/git-operations';
import { startGitRebase, controlGitRebase, getGitRebaseState } from '../../../src/infrastructure/filesystem/git-rebase';
import { getGitRebaseConflict, resolveGitRebaseConflict } from '../../../src/infrastructure/filesystem/git-rebase-conflicts';
let root: string;
const sha = async (ref = 'HEAD') => (await git(root, ['rev-parse', ref])).stdout.trim();
async function commit(value: string | Buffer) {
  await writeFile(join(root, 'file'), value);
  await git(root, ['add', '--', 'file']);
  await git(root, ['commit', '-m', 'change']);
}
async function setup(kind: 'text' | 'binary' | 'delete' = 'text') {
  await commit('original\n');
  await git(root, ['switch', '-c', 'feature']);
  await commit(kind === 'binary' ? Buffer.from([0, 255, 1]) : 'feature\n');
  await git(root, ['switch', 'main']);
  if (kind === 'delete') { await git(root, ['rm', 'file']); await git(root, ['commit', '-m', 'delete']); }
  else await commit(kind === 'binary' ? Buffer.from([0, 254, 2]) : 'base\n');
  await git(root, ['switch', 'feature']);
  return startGitRebase(root, { expectedBranch: 'feature', expectedHead: await sha(), baseBranch: 'main', baseHead: await sha('main') });
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rebase-resolution-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Test']);
  await git(root, ['config', 'user.email', 'test@example.invalid']);
  await git(root, ['config', 'commit.gpgsign', 'false']);
  await git(root, ['config', 'core.hooksPath', join(root, 'no-hooks')]);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
test.each(['text', 'feature', 'base', 'delete'] as const)('resolve %s stages only the conflict', async (resolution) => {
  await setup();
  const conflict = await getGitRebaseConflict(root, 'file');
  expect(conflict.original?.text).toBe('original\n');
  expect(conflict.base?.text).toBe('base\n');
  expect(conflict.feature?.text).toBe('feature\n');
  await writeFile(join(root, 'unrelated'), 'keep');
  await git(root, ['add', '--', 'unrelated']);
  const fresh = await getGitRebaseConflict(root, 'file');
  const state = await resolveGitRebaseConflict(root, { path: 'file', token: fresh.token, resolution, ...(resolution === 'text' ? { text: 'merged\n' } : {}) } as Parameters<typeof resolveGitRebaseConflict>[1]);
  expect(state.conflicts).toEqual([]);
  expect((await git(root, ['show', ':unrelated'])).stdout).toBe('keep');
  if (resolution === 'delete') expect(await Bun.file(join(root, 'file')).exists()).toBe(false);
  else expect(await readFile(join(root, 'file'), 'utf8')).toBe(resolution === 'text' ? 'merged\n' : `${resolution}\n`);
  await controlGitRebase(root, { action: 'abort', token: state.token! });
});
test('text resolution continues to completion without changing main', async () => {
  await setup();
  const base = await sha('main');
  const conflict = await getGitRebaseConflict(root, 'file');
  const state = await resolveGitRebaseConflict(root, { path: 'file', token: conflict.token, resolution: 'text', text: 'merged\n' });
  expect((await controlGitRebase(root, { action: 'continue', token: state.token! })).active).toBe(false);
  expect(await sha('main')).toBe(base);
  expect(await sha('HEAD^')).toBe(base);
});
test('binary side selection preserves invalid UTF-8 bytes and stale bytes reject', async () => {
  await setup('binary');
  const conflict = await getGitRebaseConflict(root, 'file');
  expect(conflict.feature?.binary).toBe(true);
  await writeFile(join(root, 'file'), Buffer.from([0, 253, 3]));
  await expect(resolveGitRebaseConflict(root, { path: 'file', token: conflict.token, resolution: 'base' })).rejects.toThrow('changed');
  const fresh = await getGitRebaseConflict(root, 'file');
  const state = await resolveGitRebaseConflict(root, { path: 'file', token: fresh.token, resolution: 'feature' });
  expect(await readFile(join(root, 'file'))).toEqual(Buffer.from([0, 255, 1]));
  await controlGitRebase(root, { action: 'continue', token: state.token! });
});
test('absent base side represents deletion', async () => {
  await setup('delete');
  const conflict = await getGitRebaseConflict(root, 'file');
  expect(conflict.base).toBeNull();
  const state = await resolveGitRebaseConflict(root, { path: 'file', token: conflict.token, resolution: 'base' });
  expect(state.conflicts).toEqual([]);
  expect(await Bun.file(join(root, 'file')).exists()).toBe(false);
  await controlGitRebase(root, { action: 'abort', token: state.token! });
});
test('base-only resolution preserves the replayed commit even when empty', async () => {
  await setup();
  const base = await sha('main');
  const conflict = await getGitRebaseConflict(root, 'file');
  const state = await resolveGitRebaseConflict(root, { path: 'file', token: conflict.token, resolution: 'base' });
  await controlGitRebase(root, { action: 'continue', token: state.token! });
  expect(await sha()).not.toBe(base);
  expect(await sha('HEAD^')).toBe(base);
});
test('worktree conflict recovery uses its own index and leaves main checkout untouched', async () => {
  await setup();
  const state = await getGitRebaseState(root);
  await controlGitRebase(root, { action: 'abort', token: state.token! });
  await git(root, ['switch', 'main']);
  const tree = join(root, 'worktree');
  await git(root, ['worktree', 'add', tree, 'feature']);
  const next = await startGitRebase(tree, { expectedBranch: 'feature', expectedHead: await sha('feature'), baseBranch: 'main', baseHead: await sha('main') });
  expect((await getGitRebaseState(tree)).token).toBe(next.token);
  const conflict = await getGitRebaseConflict(tree, 'file');
  const resolved = await resolveGitRebaseConflict(tree, { path: 'file', token: conflict.token, resolution: 'feature' });
  await controlGitRebase(tree, { action: 'continue', token: resolved.token! });
  expect(await readFile(join(root, 'file'), 'utf8')).toBe('base\n');
  expect(await readFile(join(tree, 'file'), 'utf8')).toBe('feature\n');
});
test('Abort preserves new untracked files colliding with the original tree', async () => {
  await setup('delete');
  const conflict = await getGitRebaseConflict(root, 'file');
  await resolveGitRebaseConflict(root, { path: 'file', token: conflict.token, resolution: 'delete' });
  await writeFile(join(root, 'file'), 'new untracked data');
  const state = await getGitRebaseState(root);
  await expect(controlGitRebase(root, { action: 'abort', token: state.token! })).rejects.toThrow('colliding');
  expect(await readFile(join(root, 'file'), 'utf8')).toBe('new untracked data');
});
test('rejects stale text, nonconflicts and symlink working files', async () => {
  await setup();
  const conflict = await getGitRebaseConflict(root, 'file');
  await writeFile(join(root, 'file'), 'external edit');
  await expect(resolveGitRebaseConflict(root, { path: 'file', token: conflict.token, resolution: 'delete' })).rejects.toThrow('changed');
  await expect(getGitRebaseConflict(root, '../file')).rejects.toThrow('current rebase conflict');
  await unlink(join(root, 'file'));
  await writeFile(join(root, 'target'), 'do not touch');
  await symlink('target', join(root, 'file'));
  await expect(getGitRebaseConflict(root, 'file')).rejects.toThrow('symlink');
  expect(await readFile(join(root, 'target'), 'utf8')).toBe('do not touch');
});
test('ignored paths created and deleted in intermediate commits still block rebase', async () => {
  await commit('original');
  await git(root, ['switch', '-c', 'feature']);
  await writeFile(join(root, 'temporary'), 'committed once');
  await git(root, ['add', 'temporary']); await git(root, ['commit', '-m', 'add temporary']);
  await git(root, ['rm', 'temporary']); await git(root, ['commit', '-m', 'remove temporary']);
  await git(root, ['switch', 'main']); await commit('base');
  await git(root, ['switch', 'feature']);
  await writeFile(join(root, '.git/info/exclude'), 'temporary\n');
  await writeFile(join(root, 'temporary'), 'keep ignored');
  await expect(startGitRebase(root, { expectedBranch: 'feature', expectedHead: await sha(), baseBranch: 'main', baseHead: await sha('main') })).rejects.toThrow('colliding');
  expect(await readFile(join(root, 'temporary'), 'utf8')).toBe('keep ignored');
});
test('multiple replay stops remain resolvable with refreshed tokens', async () => {
  const first = await setup();
  await controlGitRebase(root, { action: 'abort', token: first.token! });
  await commit('second feature\n');
  let state = await startGitRebase(root, { expectedBranch: 'feature', expectedHead: await sha(), baseBranch: 'main', baseHead: await sha('main') });
  expect(state.conflicts).toEqual(['file']);
  let conflict = await getGitRebaseConflict(root, 'file');
  state = await resolveGitRebaseConflict(root, { path: 'file', token: conflict.token, resolution: 'text', text: 'custom first\n' });
  state = await controlGitRebase(root, { action: 'continue', token: state.token! });
  expect(state.conflicts).toEqual(['file']);
  conflict = await getGitRebaseConflict(root, 'file');
  expect(conflict.feature?.text).toBe('second feature\n');
  state = await resolveGitRebaseConflict(root, { path: 'file', token: conflict.token, resolution: 'feature' });
  expect((await controlGitRebase(root, { action: 'continue', token: state.token! })).active).toBe(false);
});
test.each([false, true])('colliding untracked/ignored base paths are preserved, ignored=%s', async (ignored) => {
  await commit('original');
  await git(root, ['switch', '-c', 'feature']);
  await commit('feature');
  await git(root, ['switch', 'main']);
  await writeFile(join(root, 'collision'), 'base');
  await git(root, ['add', 'collision']); await git(root, ['commit', '-m', 'base']);
  await git(root, ['switch', 'feature']);
  await writeFile(join(root, 'collision'), 'local');
  if (ignored) await writeFile(join(root, '.git/info/exclude'), 'collision\n');
  await expect(startGitRebase(root, { expectedBranch: 'feature', expectedHead: await sha(), baseBranch: 'main', baseHead: await sha('main') })).rejects.toThrow('colliding');
  expect(await readFile(join(root, 'collision'), 'utf8')).toBe('local');
  expect((await getGitRebaseState(root)).active).toBe(false);
});
