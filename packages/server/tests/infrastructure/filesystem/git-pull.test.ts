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
test('pull rejects stale checkout, dirty tracked files and wrong upstream', async () => {
  await expect(runGitBranchAction(root, { action: 'pull', expectedBranch: 'other', expectedHead: head, remote: 'origin', branch: 'main' })).rejects.toThrow('checkout changed');
  await expect(runGitBranchAction(root, { action: 'pull', expectedBranch: 'main', expectedHead: head, remote: 'origin', branch: 'other' })).rejects.toThrow('upstream');
  await writeFile(join(root, 'file'), 'dirty');
  await expect(pull()).rejects.toThrow('tracked-file');
  expect(await readFile(join(root, 'file'), 'utf8')).toBe('dirty');
});
