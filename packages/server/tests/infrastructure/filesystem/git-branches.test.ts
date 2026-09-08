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

test('switch is explicit and refuses stale and checked-out targets', async () => {
  await runGitBranchAction(root, { action: 'create', name: 'feature', startHead: head });
  const input = { action: 'switch' as const, name: 'feature', expectedBranch: 'main', expectedHead: head, targetHead: head };
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

test('switch preserves unrelated staged additions and partially staged tracked edits', async () => {
  await git(root, ['switch', '-c', 'feature']);
  await writeFile(join(root, 'destination'), 'branch contents');
  await git(root, ['add', 'destination']);
  await git(root, ['commit', '-m', 'Destination']);
  const targetHead = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(root, ['switch', 'main']);
  await writeFile(join(root, 'file'), 'staged edit');
  await writeFile(join(root, 'new'), 'staged addition');
  await git(root, ['add', 'file', 'new']);
  await writeFile(join(root, 'file'), 'unstaged edit');
  await runGitBranchAction(root, { action: 'switch', name: 'feature', expectedBranch: 'main', expectedHead: head, targetHead });
  expect((await listGitBranches(root)).repository.branch).toBe('feature');
  expect((await git(root, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(targetHead);
  expect(await readFile(join(root, 'destination'), 'utf8')).toBe('branch contents');
  expect(await readFile(join(root, 'file'), 'utf8')).toBe('unstaged edit');
  expect((await git(root, ['show', ':file'])).stdout).toBe('staged edit');
  expect((await git(root, ['show', ':new'])).stdout).toBe('staged addition');
});

test.each([false, true])('switch rejects overlapping tracked edits without changing local work, staged=%s', async (staged) => {
  await git(root, ['switch', '-c', 'feature']);
  await writeFile(join(root, 'file'), 'branch contents');
  await git(root, ['add', 'file']);
  await git(root, ['commit', '-m', 'Destination']);
  const targetHead = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(root, ['switch', 'main']);
  await writeFile(join(root, 'file'), 'local work');
  if (staged) await git(root, ['add', 'file']);
  await expect(runGitBranchAction(root, { action: 'switch', name: 'feature', expectedBranch: 'main', expectedHead: head, targetHead })).rejects.toThrow();
  expect((await listGitBranches(root)).repository.branch).toBe('main');
  expect((await git(root, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(head);
  expect(await readFile(join(root, 'file'), 'utf8')).toBe('local work');
  expect((await git(root, ['show', ':file'])).stdout).toBe(staged ? 'local work' : 'initial');
});

test('track creates a local branch from the reviewed remote head without checkout', async () => {
  const remote = join(base, 'remote.git');
  await git(root, ['init', '--bare', remote]);
  await git(root, ['remote', 'add', 'origin', remote]);
  await runGitBranchAction(root, { action: 'push', sourceBranch: 'main', expectedHead: head, remote: 'origin', branch: 'feature', expectedRemoteHead: null, force: false });
  await runGitBranchAction(root, { action: 'fetch', remote: 'origin' });
  await writeFile(join(root, 'file'), 'second');
  await git(root, ['add', 'file']);
  await git(root, ['commit', '-m', 'Second']);
  const secondHead = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await runGitBranchAction(root, { action: 'track', remote: 'origin', branch: 'feature', name: 'feature', expectedHead: head });
  const tracked = (await listGitBranches(root)).branches.find((b) => b.name === 'feature');
  expect(tracked).toMatchObject({ kind: 'local', head, current: false, upstream: 'refs/remotes/origin/feature' });
  expect((await listGitBranches(root)).repository.branch).toBe('main');
  await expect(runGitBranchAction(root, { action: 'track', remote: 'origin', branch: 'feature', name: 'feature', expectedHead: head })).rejects.toThrow('already exists');
  await expect(runGitBranchAction(root, { action: 'track', remote: 'origin', branch: 'feature', name: 'other', expectedHead: secondHead })).rejects.toThrow('remote branch changed');
});

test('history annotates ahead and behind commits against an upstream', async () => {
  const remote = join(base, 'remote.git');
  await git(root, ['init', '--bare', remote]);
  await git(root, ['remote', 'add', 'origin', remote]);
  await runGitBranchAction(root, { action: 'push', sourceBranch: 'main', expectedHead: head, remote: 'origin', branch: 'main', expectedRemoteHead: null, force: false });
  await writeFile(join(root, 'file'), 'local');
  await git(root, ['add', 'file']);
  await git(root, ['commit', '-m', 'Local only']);
  const localHead = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const clone = join(base, 'clone');
  await git(base, ['clone', remote, 'clone']);
  await git(clone, ['config', 'user.name', 'Test']);
  await git(clone, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(clone, 'file'), 'remote');
  await git(clone, ['add', 'file']);
  await git(clone, ['commit', '-m', 'Remote only']);
  await git(clone, ['push', 'origin', 'main']);
  const remoteHead = (await git(clone, ['rev-parse', 'HEAD'])).stdout.trim();
  await runGitBranchAction(root, { action: 'fetch', remote: 'origin' });
  const annotated = await getGitHistory(root, localHead, 0, 'refs/remotes/origin/main');
  expect(annotated.commits.find((c) => c.head === localHead)?.sync).toBe('ahead');
  expect(annotated.commits.find((c) => c.head === remoteHead)?.sync).toBe('behind');
  expect(annotated.commits.find((c) => c.head === head)?.sync).toBeUndefined();
  const plain = await getGitHistory(root, localHead, 0);
  expect(plain.commits.every((c) => c.sync === undefined)).toBe(true);
  expect((await getGitHistory(root, localHead, 0, 'refs/remotes/origin/gone')).commits.every((c) => c.sync === undefined)).toBe(true);
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
  expect((await listGitBranches(root)).branches.find((b) => b.name === 'feature')?.upstream).toBe('refs/remotes/origin/published');
  await git(root, ['branch', '--unset-upstream', 'feature']);
  await expect(runGitBranchAction(root, { action: 'push', ...target, expectedRemoteHead: null, force: false })).rejects.toThrow('remote changed');
  expect((await listGitBranches(root)).branches.find((b) => b.name === 'feature')?.upstream).toBeNull();
  // An already-published destination must also establish missing tracking.
  expect(await runGitBranchAction(root, { action: 'push', ...target, expectedRemoteHead: head, force: false })).toEqual({});
  expect((await listGitBranches(root)).branches.find((b) => b.name === 'feature')?.upstream).toBe('refs/remotes/origin/published');
  // Publishing elsewhere must not replace an existing upstream.
  await runGitBranchAction(root, { action: 'push', ...target, branch: 'another', expectedRemoteHead: null, force: false });
  expect((await listGitBranches(root)).branches.find((b) => b.name === 'feature')?.upstream).toBe('refs/remotes/origin/published');
  await runGitBranchAction(root, { action: 'fetch', remote: 'origin' });
  expect((await listGitBranches(root)).branches.find((b) => b.name === 'origin/published')).toMatchObject({ kind: 'remote', head });
  expect((await reviewGitBranchPush(root, target)).outgoingCount).toBe(0);
  await expect(runGitBranchAction(root, { action: 'push', ...target, expectedRemoteHead: null, force: true })).rejects.toThrow('remote changed');
  await expect(runGitBranchAction(root, { action: 'fetch', remote: '--all' })).rejects.toThrow('configured remote');
});
