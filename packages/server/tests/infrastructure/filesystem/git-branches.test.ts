import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../../../src/infrastructure/filesystem/git-operations';
import { listGitBranches, getGitHistory, getGitCommitDetails, runGitBranchAction, reviewGitBranchPush } from '../../../src/infrastructure/filesystem/git-branches';
let base: string;
let root: string;
let head: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'branches-'));
  root = join(base, 'repo');
  await mkdir(root);
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Test']);
  await git(root, ['config', 'user.email', 'test@example.invalid']);
  await git(root, ['config', 'commit.gpgsign', 'false']);
  await git(root, ['config', 'core.hooksPath', join(base, 'no-hooks')]);
  await writeFile(join(root, 'file'), 'initial');
  await git(root, ['add', 'file']);
  await git(root, ['commit', '-m', 'Initial']);
  head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

test('lists branch identity, creates without switching, reads history and initial diff', async () => {
  await runGitBranchAction(root, { action: 'create', name: 'feature', startHead: head });
  const result = await listGitBranches(root);
  expect(result.repository.branch).toBe('main');
  expect(result.branches.find((b) => b.name === 'main')).toMatchObject({ current: true, checkedOut: true, kind: 'local' });
  expect((await getGitHistory(root, head, 0)).commits[0]).toMatchObject({ head, subject: 'Initial', author: 'Test' });
  expect((await getGitHistory(root, head, 50)).commits).toEqual([]);
  const details = await getGitCommitDetails(root, head);
  expect(details.files).toEqual(['file']);
  expect(details.patch).toContain('+initial');
  await expect(runGitBranchAction(root, { action: 'create', name: '../bad', startHead: head })).rejects.toThrow();
  await expect(getGitHistory(root, 'HEAD~1', 0)).rejects.toThrow('invalid commit');
});

test('switch is explicit and refuses dirty, stale and checked-out targets', async () => {
  await runGitBranchAction(root, { action: 'create', name: 'feature', startHead: head });
  const input = { action: 'switch' as const, name: 'feature', expectedBranch: 'main', expectedHead: head, targetHead: head };
  await writeFile(join(root, 'file'), 'work');
  await expect(runGitBranchAction(root, input)).rejects.toThrow('dirty');
  await writeFile(join(root, 'file'), 'initial');
  await expect(runGitBranchAction(root, { ...input, expectedHead: null })).rejects.toThrow('checkout changed');
  await git(root, ['worktree', 'add', join(base, 'linked'), 'feature']);
  expect((await listGitBranches(root)).branches.find((b) => b.name === 'feature')?.checkedOut).toBe(true);
  await expect(runGitBranchAction(root, input)).rejects.toThrow('another worktree');
  await git(root, ['worktree', 'remove', join(base, 'linked')]);
  await runGitBranchAction(root, input);
  expect((await listGitBranches(root)).repository.branch).toBe('feature');
});

test('switch preserves nonconflicting untracked files', async () => {
  await runGitBranchAction(root, { action: 'create', name: 'feature', startHead: head });
  await writeFile(join(root, 'local-only'), 'keep me');
  await runGitBranchAction(root, { action: 'switch', name: 'feature', expectedBranch: 'main', expectedHead: head, targetHead: head });
  expect((await listGitBranches(root)).repository.branch).toBe('feature');
  expect(await readFile(join(root, 'local-only'), 'utf8')).toBe('keep me');
});

test.each([false, true])('switch protects colliding local files, ignored=%s', async (ignored) => {
  await git(root, ['switch', '-c', 'feature']);
  await writeFile(join(root, 'collision'), 'branch contents');
  await git(root, ['add', 'collision']);
  await git(root, ['commit', '-m', 'Add destination file']);
  const targetHead = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(root, ['switch', 'main']);
  await writeFile(join(root, 'collision'), 'local contents');
  if (ignored) await writeFile(join(root, '.git/info/exclude'), 'collision\n');
  await expect(runGitBranchAction(root, { action: 'switch', name: 'feature', expectedBranch: 'main', expectedHead: head, targetHead })).rejects.toThrow();
  expect((await listGitBranches(root)).repository.branch).toBe('main');
  expect(await readFile(join(root, 'collision'), 'utf8')).toBe('local contents');
});

test('switch still rejects staged additions', async () => {
  await runGitBranchAction(root, { action: 'create', name: 'feature', startHead: head });
  await writeFile(join(root, 'new'), 'staged');
  await git(root, ['add', 'new']);
  await expect(runGitBranchAction(root, { action: 'switch', name: 'feature', expectedBranch: 'main', expectedHead: head, targetHead: head })).rejects.toThrow('staged changes');
  expect((await listGitBranches(root)).repository.branch).toBe('main');
});

test('explicit source push preview, fetch and stale remote lease', async () => {
  const remote = join(base, 'remote.git');
  await git(root, ['init', '--bare', remote]);
  await git(root, ['remote', 'add', 'origin', remote]);
  await runGitBranchAction(root, { action: 'create', name: 'feature', startHead: head });
  const target = { sourceBranch: 'feature', expectedHead: head, remote: 'origin', branch: 'published' };
  const review = await reviewGitBranchPush(root, target);
  expect(review).toMatchObject({ remoteHead: null, outgoingCount: 1, remoteOnlyCount: 0 });
  await runGitBranchAction(root, { action: 'push', ...target, expectedRemoteHead: null, force: false });
  expect((await listGitBranches(root)).repository.branch).toBe('main');
  await runGitBranchAction(root, { action: 'fetch', remote: 'origin' });
  expect((await listGitBranches(root)).branches.find((b) => b.name === 'origin/published')).toMatchObject({ kind: 'remote', head });
  expect((await reviewGitBranchPush(root, target)).outgoingCount).toBe(0);
  await expect(runGitBranchAction(root, { action: 'push', ...target, expectedRemoteHead: null, force: true })).rejects.toThrow('remote changed');
  await expect(runGitBranchAction(root, { action: 'fetch', remote: '--all' })).rejects.toThrow('configured remote');
});
