import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../../../src/infrastructure/filesystem/git-operations';
import { runGitBranchAction } from '../../../src/infrastructure/filesystem/git-branches';
let base: string;
let root: string;
let peer: string;
let head: string;
const sha = async (cwd: string) => (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
async function commit(cwd: string, file: string, text: string) {
  await writeFile(join(cwd, file), text);
  await git(cwd, ['add', '--', file]);
  await git(cwd, ['commit', '-m', text]);
  return sha(cwd);
}
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'git-pull-'));
  root = join(base, 'local'); peer = join(base, 'peer');
  await mkdir(root);
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Test']);
  await git(root, ['config', 'user.email', 'test@example.invalid']);
  await git(root, ['config', 'commit.gpgsign', 'false']);
  await git(root, ['config', 'core.hooksPath', join(base, 'no-hooks')]);
  head = await commit(root, 'file', 'initial');
  const remote = join(base, 'remote.git');
  await git(root, ['init', '--bare', remote]);
  await git(root, ['remote', 'add', 'origin', remote]);
  await git(root, ['push', '-u', 'origin', 'main']);
  await git(root, ['clone', '-b', 'main', remote, peer]);
  await git(peer, ['config', 'user.name', 'Test']);
  await git(peer, ['config', 'user.email', 'test@example.invalid']);
  await git(peer, ['config', 'commit.gpgsign', 'false']);
  await git(peer, ['config', 'core.hooksPath', join(base, 'no-hooks')]);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });
const pull = () => runGitBranchAction(root, { action: 'pull', expectedBranch: 'main', expectedHead: head, remote: 'origin', branch: 'main' });
const pullBranch = () => runGitBranchAction(root, { action: 'pull-branch', name: 'main', expectedHead: head });
const mainHead = async () => (await git(root, ['rev-parse', 'refs/heads/main'])).stdout.trim();

test('pull browsed main preserves development HEAD, staged, dirty, ignored and untracked files', async () => {
  await git(root, ['switch', '-c', 'dev']);
  const devHead = await commit(root, 'dev', 'development');
  const next = await commit(peer, 'file', 'remote change');
  await git(peer, ['push']);
  await writeFile(join(root, 'file'), 'staged');
  await git(root, ['add', 'file']);
  await writeFile(join(root, 'file'), 'dirty');
  await writeFile(join(root, 'untracked'), 'keep');
  await writeFile(join(root, '.git/info/exclude'), 'ignored\n');
  await writeFile(join(root, 'ignored'), 'keep ignored');
  const index = await readFile(join(root, '.git/index'));
  await pullBranch();
  expect(await mainHead()).toBe(next);
  expect(await sha(root)).toBe(devHead);
  expect((await git(root, ['branch', '--show-current'])).stdout.trim()).toBe('dev');
  expect(await readFile(join(root, '.git/index'))).toEqual(index);
  expect(await readFile(join(root, 'file'), 'utf8')).toBe('dirty');
  expect(await readFile(join(root, 'untracked'), 'utf8')).toBe('keep');
  expect(await readFile(join(root, 'ignored'), 'utf8')).toBe('keep ignored');
  head = next;
  await pullBranch();
  expect(await mainHead()).toBe(next);
});

test('non-checkout pull refuses divergence and stale target heads', async () => {
  const initial = head;
  head = await commit(root, 'local', 'local change');
  await git(root, ['switch', '-c', 'dev']);
  await commit(peer, 'remote', 'remote change');
  await git(peer, ['push']);
  await expect(pullBranch()).rejects.toThrow('diverged');
  expect(await mainHead()).toBe(head);
  await expect(runGitBranchAction(root, { action: 'pull-branch', name: 'main', expectedHead: initial })).rejects.toThrow('target branch changed');
});

test('non-checkout pull refuses current and other-worktree branches', async () => {
  await expect(pullBranch()).rejects.toThrow('checked out');
  await git(root, ['switch', '-c', 'dev']);
  await git(root, ['worktree', 'add', join(base, 'linked'), 'main']);
  await expect(pullBranch()).rejects.toThrow('checked out');
  expect(await mainHead()).toBe(head);
});

test('non-checkout pull refuses detached rebase ownership', async () => {
  await git(root, ['switch', '-c', 'dev']);
  const linked = join(base, 'linked');
  await git(root, ['worktree', 'add', '--detach', linked, head]);
  const dir = (await git(linked, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
  await mkdir(join(dir, 'rebase-merge'));
  await writeFile(join(dir, 'rebase-merge/head-name'), 'refs/heads/main\n');
  await expect(pullBranch()).rejects.toThrow('in-progress');
  expect(await mainHead()).toBe(head);
});

test('non-checkout pull never rewinds an ahead branch and rejects missing upstream', async () => {
  head = await commit(root, 'local', 'local change');
  await git(root, ['switch', '-c', 'dev']);
  await pullBranch();
  expect(await mainHead()).toBe(head);
  await git(root, ['config', '--unset', 'branch.main.remote']);
  await expect(pullBranch()).rejects.toThrow();
  expect(await mainHead()).toBe(head);
});
test('pull fetches and fast-forwards without touching unrelated untracked files', async () => {
  const next = await commit(peer, 'file', 'remote change');
  await git(peer, ['push']);
  await writeFile(join(root, 'local-only'), 'keep');
  await pull();
  expect(await sha(root)).toBe(next);
  expect(await readFile(join(root, 'file'), 'utf8')).toBe('remote change');
  expect(await readFile(join(root, 'local-only'), 'utf8')).toBe('keep');
  head = next;
  await pull();
  expect(await sha(root)).toBe(next);
});
test('pull refuses divergence without merging or dropping local commits', async () => {
  head = await commit(root, 'local', 'local work');
  await commit(peer, 'remote', 'remote work');
  await git(peer, ['push']);
  await expect(pull()).rejects.toThrow('diverged');
  expect(await sha(root)).toBe(head);
});
test.each([false, true])('pull preserves colliding files, ignored=%s', async (ignored) => {
  await commit(peer, 'collision', 'remote work');
  await git(peer, ['push']);
  await writeFile(join(root, 'collision'), 'local work');
  if (ignored) await writeFile(join(root, '.git/info/exclude'), 'collision\n');
  await expect(pull()).rejects.toThrow();
  expect(await sha(root)).toBe(head);
  expect(await readFile(join(root, 'collision'), 'utf8')).toBe('local work');
});
test('pull rejects stale checkout and wrong upstream', async () => {
  await expect(runGitBranchAction(root, { action: 'pull', expectedBranch: 'other', expectedHead: head, remote: 'origin', branch: 'main' })).rejects.toThrow('checkout changed');
  await expect(runGitBranchAction(root, { action: 'pull', expectedBranch: 'main', expectedHead: head, remote: 'origin', branch: 'other' })).rejects.toThrow('upstream');
});

test('pull preserves unrelated staged additions and partially staged tracked edits', async () => {
  const next = await commit(peer, 'remote-only', 'remote work');
  await git(peer, ['push']);
  await writeFile(join(root, 'file'), 'staged edit');
  await writeFile(join(root, 'new'), 'staged addition');
  await git(root, ['add', 'file', 'new']);
  await writeFile(join(root, 'file'), 'unstaged edit');
  await pull();
  expect(await sha(root)).toBe(next);
  expect(await readFile(join(root, 'remote-only'), 'utf8')).toBe('remote work');
  expect(await readFile(join(root, 'file'), 'utf8')).toBe('unstaged edit');
  expect((await git(root, ['show', ':file'])).stdout).toBe('staged edit');
  expect((await git(root, ['show', ':new'])).stdout).toBe('staged addition');
});

test.each([false, true])('pull rejects overlapping tracked edits without changing local work, staged=%s', async (staged) => {
  await commit(peer, 'file', 'remote work');
  await git(peer, ['push']);
  await writeFile(join(root, 'file'), 'local work');
  if (staged) await git(root, ['add', 'file']);
  await expect(pull()).rejects.toThrow();
  expect(await sha(root)).toBe(head);
  expect(await readFile(join(root, 'file'), 'utf8')).toBe('local work');
  expect((await git(root, ['show', ':file'])).stdout).toBe(staged ? 'local work' : 'initial');
});
