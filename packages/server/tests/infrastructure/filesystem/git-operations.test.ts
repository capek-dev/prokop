import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitGitFiles, getGitRepository, previewGitPush, pushGitBranch } from '../../../src/infrastructure/filesystem/git-operations';
import { getGitStatus } from '../../../src/infrastructure/filesystem/git-status';

let root: string;
let base: string;
async function git(...args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code) throw new Error(stderr);
  return stdout.replace(/\n$/, '');
}
async function commit(paths: string[]) {
  const state = await getGitRepository(root);
  return commitGitFiles(root, { paths, message: 'Selected files', expectedBranch: state.branch!, expectedHead: state.head });
}
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'prokop-git-ops-'));
  root = base;
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Test');
  await git('config', 'user.email', 'test@example.invalid');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'core.hooksPath', join(root, '.git/hooks'));
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

describe('selected whole-file commits', () => {
  test('initial commit excludes unrelated staged files', async () => {
    await writeFile(join(root, 'selected'), 'one');
    await writeFile(join(root, 'other'), 'two');
    await git('add', 'other');
    const result = await commit(['selected']);
    expect(result.warning).toBeUndefined();
    expect(await git('ls-tree', '--name-only', 'HEAD')).toBe('selected');
    expect(await git('diff', '--cached', '--name-only')).toBe('other');
  });
  test('uses whole contents and preserves unchecked index and working edits', async () => {
    await writeFile(join(root, 'selected'), 'base');
    await writeFile(join(root, 'other'), 'base');
    await commit(['selected', 'other']);
    await writeFile(join(root, 'selected'), 'staged');
    await writeFile(join(root, 'other'), 'other staged');
    await git('add', '.');
    await writeFile(join(root, 'selected'), 'current');
    await writeFile(join(root, 'other'), 'other current');
    await commit(['selected']);
    expect(await git('show', 'HEAD:selected')).toBe('current');
    expect(await git('show', ':other')).toBe('other staged');
    expect(await readFile(join(root, 'other'), 'utf8')).toBe('other current');
    expect(await git('diff', '--cached', '--name-only')).toBe('other');
  });
  test('literal filenames, rename and deletion', async () => {
    const names = ['[ab]', 'line\nbreak', ' space ', ':(glob)*', "quote'file"];
    // Status must preserve the same literal paths used by the commit picker.
    for (const name of names) await writeFile(join(root, name), name);
    expect([...(await getGitStatus(root)).files.keys()].sort()).toEqual([...names].sort());
    await commit(names);
    expect((await git('ls-tree', '-z', '--name-only', 'HEAD')).split('\0').filter(Boolean).sort()).toEqual(names.sort());
    await rename(join(root, '[ab]'), join(root, 'renamed'));
    await git('add', '-A');
    await commit(['renamed']);
    expect(await git('status', '--porcelain')).toBe('');
    await rm(join(root, 'renamed'));
    await commit(['renamed']);
    expect(await git('status', '--porcelain')).toBe('');
  });
  test('commits paths relative to a selected subdirectory', async () => {
    await writeFile(join(root, 'outside'), 'keep staged');
    await git('add', 'outside');
    const sub = join(root, 'sub');
    await Bun.write(join(sub, 'a'), 'selected');
    root = sub;
    const result = await commit(['a']);
    expect(result.warning).toBeUndefined();
    expect(await git('show', 'HEAD:sub/a')).toBe('selected');
    root = base;
    expect(await git('diff', '--cached', '--name-only')).toBe('outside');
  });
  test('commits from a linked worktree without changing the main index', async () => {
    await writeFile(join(root, 'a'), 'base');
    await commit(['a']);
    const main = root;
    const mainIndex = await readFile(join(main, '.git/index'));
    await git('worktree', 'add', '-b', 'feature', join(main, 'linked'));
    root = join(main, 'linked');
    await writeFile(join(root, 'a'), 'feature');
    const result = await commit(['a']);
    expect(result.warning).toBeUndefined();
    expect(await git('show', 'HEAD:a')).toBe('feature');
    expect(await readFile(join(main, '.git/index'))).toEqual(mainIndex);
  });
  test('hook failure leaves HEAD and index unchanged', async () => {
    await writeFile(join(root, 'a'), 'base');
    await commit(['a']);
    const head = await git('rev-parse', 'HEAD');
    await writeFile(join(root, 'a'), 'changed');
    const index = await readFile(join(root, '.git/index'));
    const hook = join(root, '.git/hooks/pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);
    await expect(commit(['a'])).rejects.toThrow('Git operation:');
    expect(await git('rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(join(root, '.git/index'))).toEqual(index);
  });
  test('refuses hooks that stage unchecked files without advancing HEAD', async () => {
    await writeFile(join(root, 'a'), 'base');
    await writeFile(join(root, 'other'), 'base');
    await commit(['a', 'other']);
    const head = await git('rev-parse', 'HEAD');
    await writeFile(join(root, 'a'), 'changed');
    await writeFile(join(root, 'other'), 'unchecked');
    const index = await readFile(join(root, '.git/index'));
    const hook = join(root, '.git/hooks/pre-commit');
    await writeFile(hook, '#!/bin/sh\ngit add -A\n');
    await chmod(hook, 0o755);
    await expect(commit(['a'])).rejects.toThrow('hook staged unchecked files');
    expect(await git('rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(join(root, '.git/index'))).toEqual(index);
  });
  test('signing failure preserves index and HEAD', async () => {
    await writeFile(join(root, 'a'), 'base');
    await commit(['a']);
    const head = await git('rev-parse', 'HEAD');
    const index = await readFile(join(root, '.git/index'));
    await writeFile(join(root, 'a'), 'changed');
    await git('config', 'commit.gpgsign', 'true');
    await git('config', 'gpg.program', 'false');
    await expect(commit(['a'])).rejects.toThrow('Git operation:');
    expect(await git('rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(join(root, '.git/index'))).toEqual(index);
  });
  test('concurrent commits with the same HEAD cannot both succeed', async () => {
    await writeFile(join(root, 'a'), 'base');
    await commit(['a']);
    const expectedHead = await git('rev-parse', 'HEAD');
    await writeFile(join(root, 'a'), 'changed');
    const input = { paths: ['a'], message: 'once', expectedBranch: 'main', expectedHead };
    const results = await Promise.allSettled([commitGitFiles(root, input), commitGitFiles(root, input)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await git('rev-list', '--count', 'HEAD')).toBe('2');
  });
  test('rejects stale HEAD, locked index, directories and traversal', async () => {
    await writeFile(join(root, 'a'), 'base');
    await commit(['a']);
    await expect(commitGitFiles(root, { paths: ['a'], message: 'x', expectedBranch: 'main', expectedHead: null })).rejects.toThrow('HEAD changed');
    await expect(commit(['../escape'])).rejects.toThrow('invalid file path');
    await expect(commit(['.git'])).rejects.toThrow('invalid file path');
    await writeFile(join(root, '.git/index.lock'), 'busy');
    await expect(commit(['a'])).rejects.toThrow('index is locked');
    expect(await readFile(join(root, '.git/index.lock'), 'utf8')).toBe('busy');
  });
});

test('publish, normal push rejection, explicit force lease and stale lease rejection', async () => {
  await writeFile(join(root, 'a'), 'base');
  const first = await commit(['a']);
  const remote = join(root, 'remote.git');
  await git('init', '--bare', remote);
  await git('remote', 'add', 'test', remote);
  const destination = { remote: 'test', branch: 'published' };
  expect(await previewGitPush(root, destination)).toEqual({ remoteHead: null });
  await pushGitBranch(root, { ...destination, expectedBranch: 'main', expectedHead: first.head, setUpstream: true });
  expect((await getGitRepository(root)).upstream).toEqual(destination);
  await writeFile(join(root, 'a'), 'next');
  const second = await commit(['a']);
  await pushGitBranch(root, { ...destination, expectedBranch: 'main', expectedHead: second.head });
  await expect(pushGitBranch(root, { ...destination, expectedBranch: 'main', expectedHead: second.head, force: true })).rejects.toThrow('explicit reviewed');
  await expect(pushGitBranch(root, { ...destination, expectedBranch: 'main', expectedHead: second.head, force: true, expectedRemoteHead: first.head })).rejects.toThrow('push rejected');
  expect(await previewGitPush(root, destination)).toEqual({ remoteHead: second.head });
  await git('update-ref', 'refs/heads/main', first.head);
  await expect(pushGitBranch(root, { ...destination, expectedBranch: 'main', expectedHead: first.head })).rejects.toThrow('push rejected');
  await pushGitBranch(root, { ...destination, expectedBranch: 'main', expectedHead: first.head, force: true, expectedRemoteHead: second.head });
  expect(await previewGitPush(root, destination)).toEqual({ remoteHead: first.head });
});
