import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../../../src/infrastructure/filesystem/git-operations';
import { controlGitRebase, getGitRebaseState, startGitRebase } from '../../../src/infrastructure/filesystem/git-rebase';

let root: string;
let featureHead: string;
let baseHead: string;
const sha = async (ref = 'HEAD') => (await git(root, ['rev-parse', ref])).stdout.trim();
async function commit(file: string, content: string): Promise<string> {
  await writeFile(join(root, file), content);
  await git(root, ['add', '--', file]);
  await git(root, ['commit', '-m', 'test change']);
  return sha();
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'git-rebase-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Test']);
  await git(root, ['config', 'user.email', 'test@example.invalid']);
  await git(root, ['config', 'commit.gpgsign', 'false']);
  await git(root, ['config', 'core.hooksPath', join(root, 'no-hooks')]);
  await commit('file', 'original\n');
  await git(root, ['switch', '-c', 'feature/1232']);
  featureHead = await commit('file', 'feature\n');
  await git(root, ['switch', 'main']);
  baseHead = await commit('file', 'base\n');
  await git(root, ['switch', 'feature/1232']);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const start = () => startGitRebase(root, { expectedBranch: 'feature/1232', expectedHead: featureHead, baseBranch: 'main', baseHead });

test('conflict state survives reread; abort restores feature without moving main', async () => {
  const state = await start();
  expect(state.active).toBe(true);
  expect(state.branch).toBe('feature/1232');
  expect(state.conflicts).toEqual(['file']);
  expect(await getGitRebaseState(root)).toEqual(state);
  await git(root, ['status', '--porcelain=v1']);
  expect((await getGitRebaseState(root)).token).toBe(state.token);
  await expect(controlGitRebase(root, { action: 'continue', token: state.token! })).rejects.toThrow('resolve and stage');
  expect((await controlGitRebase(root, { action: 'abort', token: state.token! })).active).toBe(false);
  expect(await sha()).toBe(featureHead);
  expect(await sha('main')).toBe(baseHead);
  expect(await readFile(join(root, 'file'), 'utf8')).toBe('feature\n');
});
test('continue rejects stale content and completes only after explicit conflict staging', async () => {
  const state = await start();
  await writeFile(join(root, 'file'), 'resolved\n');
  await expect(controlGitRebase(root, { action: 'abort', token: state.token! })).rejects.toThrow('rebase changed');
  await git(root, ['add', '--', 'file']);
  const resolved = await getGitRebaseState(root);
  expect(resolved.conflicts).toEqual([]);
  expect((await controlGitRebase(root, { action: 'continue', token: resolved.token! })).active).toBe(false);
  expect((await git(root, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim()).toBe('feature/1232');
  expect(await sha('HEAD^')).toBe(baseHead);
  expect(await sha('main')).toBe(baseHead);
  expect(await readFile(join(root, 'file'), 'utf8')).toBe('resolved\n');
});
test('start rejects remote-only bases, stale tips, dirty checkout and active rebase', async () => {
  await expect(startGitRebase(root, { expectedBranch: 'feature/1232', expectedHead: featureHead, baseBranch: 'origin/main', baseHead })).rejects.toThrow('local base');
  await expect(startGitRebase(root, { expectedBranch: 'feature/1232', expectedHead: baseHead, baseBranch: 'main', baseHead })).rejects.toThrow('checkout changed');
  await expect(startGitRebase(root, { expectedBranch: 'feature/1232', expectedHead: featureHead, baseBranch: 'main', baseHead: featureHead })).rejects.toThrow('local base');
  await writeFile(join(root, 'file'), 'dirty');
  await expect(start()).rejects.toThrow('commit or move');
  await writeFile(join(root, 'file'), 'feature\n');
  await start();
  await expect(start()).rejects.toThrow('in-progress');
});
test('clean replay leaves base and other refs unchanged despite updateRefs setting', async () => {
  await git(root, ['switch', 'main']);
  await git(root, ['switch', '-c', 'clean']);
  const cleanHead = await commit('other', 'clean work');
  await git(root, ['branch', 'keep-tip']);
  await git(root, ['switch', 'main']);
  baseHead = await commit('base-only', 'base work');
  await git(root, ['switch', 'clean']);
  await git(root, ['config', 'rebase.updateRefs', 'true']);
  const result = await startGitRebase(root, { expectedBranch: 'clean', expectedHead: cleanHead, baseBranch: 'main', baseHead });
  expect(result.active).toBe(false);
  expect(await sha('HEAD^')).toBe(baseHead);
  expect(await sha('main')).toBe(baseHead);
  expect(await sha('keep-tip')).toBe(cleanHead);
});
test.each([false, true])('start preserves untracked files, ignored=%s', async (ignored) => {
  await writeFile(join(root, 'local-only'), 'keep');
  if (ignored) await writeFile(join(root, '.git/info/exclude'), 'local-only\n');
  const state = await start();
  expect(state.active).toBe(true);
  expect(await readFile(join(root, 'local-only'), 'utf8')).toBe('keep');
  await controlGitRebase(root, { action: 'abort', token: state.token! });
  expect(await sha()).toBe(featureHead);
});
