import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, relative, isAbsolute } from 'path';
import { createGitStatus } from '@/infrastructure/filesystem/git-status';

const gitOps = createGitStatus({
  isPathWithinWorkspace: (path, root) => {
    const rel = relative(root, path);
    return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
  },
});
let root: string;
async function git(...args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  if (code !== 0) throw new Error(stderr);
  return stdout;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'git-add-test-'));
  await git('init', '-q');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('add one untracked file', () => {
  test('stages only the selected file, including in an unborn repository', async () => {
    await writeFile(join(root, 'new.txt'), 'new\n');
    await writeFile(join(root, 'other.txt'), 'other\n');
    expect(await gitOps.addUntrackedFile(root, 'new.txt')).toEqual({ path: 'new.txt' });
    expect(await git('diff', '--cached', '--name-only')).toBe('new.txt\n');
    const status = await gitOps.getGitStatus(root);
    expect(status.files.get('new.txt')).toMatchObject({ status: 'added', staged: true, unstaged: false });
    expect(status.files.get('other.txt')?.status).toBe('untracked');
  });

  test.each(['space name.txt', '[ab].txt', '*.txt', '-n', ':(glob)*', 'line\nbreak.txt'])('treats %j as a literal filename', async (name) => {
    await writeFile(join(root, name), 'new\n');
    await writeFile(join(root, 'a.txt'), 'other\n');
    await gitOps.addUntrackedFile(root, name);
    expect(await git('diff', '--cached', '--name-only', '-z')).toBe(`${name}\0`);
  });

  test('uses the selected subdirectory root', async () => {
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, 'sub/new.txt'), 'new\n');
    await writeFile(join(root, 'new.txt'), 'other\n');
    await gitOps.addUntrackedFile(join(root, 'sub'), 'new.txt');
    expect(await git('diff', '--cached', '--name-only')).toBe('sub/new.txt\n');
  });

  test('refuses ignored files and files already in the index', async () => {
    await writeFile(join(root, '.gitignore'), '*.log\n');
    await writeFile(join(root, 'secret.log'), 'secret');
    await writeFile(join(root, 'new.txt'), 'original');
    await gitOps.addUntrackedFile(root, 'new.txt');
    await writeFile(join(root, 'new.txt'), 'changed');
    await expect(gitOps.addUntrackedFile(root, 'secret.log')).rejects.toThrow('Only untracked files');
    await expect(gitOps.addUntrackedFile(root, 'new.txt')).rejects.toThrow('Only untracked files');
    expect(await git('show', ':new.txt')).toBe('original');
  });

  test.each(['.', '..', '../escape', '/tmp/escape', 'C:/escape', '.git/config', 'sub/../file', 'sub\\file', 'bad\0file'])('rejects invalid path %j', async (path) => {
    await expect(gitOps.addUntrackedFile(root, path)).rejects.toThrow('Invalid Git file path');
  });

  test('refuses directories, missing files, and symlink-parent escapes', async () => {
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, 'new.txt'), 'new');
    await symlink(root, join(root, 'sub/outside'));
    await expect(gitOps.addUntrackedFile(root, 'sub')).rejects.toThrow('Invalid Git file path');
    await expect(gitOps.addUntrackedFile(root, 'missing')).rejects.toThrow('Path not found');
    await expect(gitOps.addUntrackedFile(join(root, 'sub'), 'outside/new.txt')).rejects.toThrow('Path outside workspace');
    expect(await git('diff', '--cached', '--name-only')).toBe('');
  });

  test('reports an index lock without changing the index', async () => {
    await writeFile(join(root, 'new.txt'), 'new');
    await writeFile(join(root, '.git/index.lock'), '');
    await expect(gitOps.addUntrackedFile(root, 'new.txt')).rejects.toThrow('Git add failed:');
    expect(await git('ls-files')).toBe('');
  });
});
