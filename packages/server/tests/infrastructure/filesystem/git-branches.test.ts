import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, gitOutputTail, GitOperationError, runGitPush } from '@/infrastructure/filesystem/git-operations';
import { listGitBranches, getGitHistory, getGitCommitDetails, runGitBranchAction, reviewGitBranchPush } from '@/infrastructure/filesystem/git-branches';
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

test('history reports parents and branches report commit date and fetch time across worktrees', async () => {
  const branches = await listGitBranches(root);
  expect(branches.lastFetchedAt).toBeNull();
  expect(Date.parse(branches.branches.find((b) => b.name === 'main')!.committedAt!)).not.toBeNaN();
  await git(root, ['switch', '-c', 'side']);
  await writeFile(join(root, 'side'), 'side');
  await git(root, ['add', 'side']);
  await git(root, ['commit', '-m', 'Side']);
  const side = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(root, ['switch', 'main']);
  await git(root, ['merge', '--no-ff', '--no-edit', 'side']);
  const merge = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const commits = (await getGitHistory(root, merge, 0)).commits;
  expect(commits.find((c) => c.head === merge)?.parents).toEqual([head, side]);
  expect(commits.find((c) => c.head === head)?.parents).toEqual([]);
  // A fetch from a linked worktree writes that worktree's FETCH_HEAD only.
  const remote = join(base, 'remote.git');
  await git(root, ['init', '--bare', remote]);
  await git(root, ['remote', 'add', 'origin', remote]);
  await git(root, ['worktree', 'add', join(base, 'linked'), 'side']);
  await runGitBranchAction(join(base, 'linked'), { action: 'fetch', remote: 'origin' });
  const fetchedAt = (await listGitBranches(root)).lastFetchedAt;
  expect(fetchedAt).not.toBeNull();
  expect(Math.abs(Date.now() - Date.parse(fetchedAt!))).toBeLessThan(60_000);
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

test('set-upstream adopts a branch published outside the workbench, even before a fetch', async () => {
  const remote = join(base, 'remote.git');
  await git(root, ['init', '--bare', remote]);
  await git(root, ['remote', 'add', 'origin', remote]);
  await runGitBranchAction(root, { action: 'create', name: 'feature', startHead: head });
  // A terminal push without -u: the remote has the branch, nothing tracks it.
  await git(root, ['push', 'origin', 'feature']);
  await git(root, ['update-ref', '-d', 'refs/remotes/origin/feature']);
  const before = (await listGitBranches(root)).branches.find((b) => b.name === 'feature');
  expect(before?.upstream).toBeNull();
  expect((await reviewGitBranchPush(root, { sourceBranch: 'feature', expectedHead: head, remote: 'origin', branch: 'feature' })).outgoingCount).toBe(0);
  expect(await runGitBranchAction(root, { action: 'set-upstream', name: 'feature', remote: 'origin', branch: 'feature' })).toEqual({});
  expect((await listGitBranches(root)).branches.find((b) => b.name === 'feature')).toMatchObject({ upstream: 'refs/remotes/origin/feature', ahead: 0, behind: 0 });
  await expect(runGitBranchAction(root, { action: 'set-upstream', name: 'feature', remote: 'origin', branch: 'feature' })).rejects.toThrow('already has an upstream');
  await expect(runGitBranchAction(root, { action: 'set-upstream', name: 'main', remote: 'origin', branch: 'missing' })).rejects.toThrow('does not exist');
  expect((await listGitBranches(root)).branches.find((b) => b.name === 'main')?.upstream).toBeNull();
});

describe('pre-push hooks', () => {
  let remote: string;
  const rejection = (pending: Promise<unknown>) => pending.then(() => { throw new Error('expected the push to fail'); }, (error: unknown) => error as GitOperationError);
  const target = () => ({ action: 'push' as const, sourceBranch: 'main', expectedHead: head, remote: 'origin', branch: 'main', expectedRemoteHead: null, force: false });
  const hook = async (body: string) => {
    const hooks = join(base, 'hooks');
    await mkdir(hooks, { recursive: true });
    await writeFile(join(hooks, 'pre-push'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    await git(root, ['config', 'core.hooksPath', hooks]);
  };
  beforeEach(async () => {
    remote = join(base, 'remote.git');
    await git(root, ['init', '--bare', remote]);
    await git(root, ['remote', 'add', 'origin', remote]);
  });

  test('a failing hook reports its output, and runHooks false skips it', async () => {
    // "rejected" in hook output must not read as a remote rejection.
    await hook('echo "lint: 3 problems, push rejected"\necho "see https://user:hunter2@ci.example/run" >&2\nexit 1');
    const failure = await rejection(runGitBranchAction(root, target()));
    expect(failure).toBeInstanceOf(GitOperationError);
    expect(failure.message).toContain('pre-push hook failed');
    expect(failure.details.reason).toBe('pre-push-hook');
    expect(failure.details.output).toContain('lint: 3 problems, push rejected');
    expect(failure.details.output).toContain('https://***@ci.example/run');
    expect(failure.details.output).not.toContain('hunter2');
    expect((await git(root, ['ls-remote', remote])).stdout).toBe('');
    expect(await runGitBranchAction(root, { ...target(), runHooks: false })).toEqual({});
    expect((await git(root, ['ls-remote', remote, 'refs/heads/main'])).stdout).toContain(head);
  });

  test('a hook that outlives the push limit is stopped with its output so far', async () => {
    await hook('echo "running 812 tests"\nsleep 5');
    const failure = await rejection(runGitPush(root, { remote: 'origin', head, branch: 'main' }, 500));
    expect(failure.details.reason).toBe('timeout');
    expect(failure.message).toContain('pre-push hook was probably still running');
    expect(failure.details.output).toContain('running 812 tests');
    expect((await git(root, ['ls-remote', remote])).stdout).toBe('');
  });

  test('a remote rejection is told apart from a hook failure', async () => {
    await hook('exit 0');
    await runGitBranchAction(root, target());
    await writeFile(join(root, 'file'), 'diverged');
    await git(root, ['commit', '-am', 'Diverged', '--amend']);
    const amended = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const failure = await rejection(runGitPush(root, { remote: 'origin', head: amended, branch: 'main' }));
    expect(failure.details.reason).toBe('rejected');
    expect(failure.message).toContain('push rejected');
  });
});

test('git output tail drops colour codes and progress frames and keeps the last lines', () => {
  expect(gitOutputTail('\x1b[31mred\x1b[0m\nCounting 10%\rCounting 100%\n\n')).toBe('red\nCounting 100%');
  expect(gitOutputTail(Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'), 3)).toBe('line 97\nline 98\nline 99');
});
