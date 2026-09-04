import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWorktreeGitPort,
  WorktreeGitError,
} from '@/infrastructure/git-worktrees';

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(['git', '-C', cwd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...Bun.env,
      LC_ALL: 'C',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || result.stdout.toString());
  }
  return result.stdout.toString();
}

describe('worktree Git adapter', () => {
  let root: string;
  let repositoryPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'prokop-worktrees-'));
    repositoryPath = join(root, 'repository');
    mkdirSync(repositoryPath);
    git(repositoryPath, ['init']);
    git(repositoryPath, ['config', 'user.name', 'Prokop Test']);
    git(repositoryPath, ['config', 'user.email', 'prokop@example.invalid']);
    writeFileSync(join(repositoryPath, 'README.md'), '# Fixture\n');
    git(repositoryPath, ['add', 'README.md']);
    git(repositoryPath, ['commit', '-m', 'Initial commit']);
    git(repositoryPath, ['branch', 'feature/available']);
    git(repositoryPath, ['update-ref', 'refs/remotes/origin/remote-only', 'HEAD']);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('lists local branches, uses an existing branch, and safely removes its worktree', async () => {
    const adapter = createWorktreeGitPort();
    const identity = await adapter.inspectRepository(repositoryPath);
    const destinationPath = join(root, 'managed', 'worktree-1');

    expect(identity.selectedRoot).toBe(realpathSync(repositoryPath));
    expect(identity.repositoryTopLevel).toBe(realpathSync(repositoryPath));
    expect(identity.repositoryId).toHaveLength(24);
    expect(await adapter.listRefs(repositoryPath)).toEqual([
      expect.objectContaining({
        name: 'feature/available',
        ref: 'refs/heads/feature/available',
        kind: 'local',
        current: false,
        checkedOut: false,
      }),
      expect.objectContaining({
        name: expect.any(String),
        ref: expect.stringMatching(/^refs\/heads\//),
        kind: 'local',
        current: true,
        checkedOut: true,
      }),
    ]);

    const created = await adapter.create({
      repositoryPath,
      destinationPath,
      branch: 'refs/heads/feature/available',
    });
    expect(created.branch).toBe('feature/available');
    expect(created.dirty).toBe(false);
    expect(existsSync(destinationPath)).toBe(true);
    expect(git(repositoryPath, ['show-ref', '--verify', 'refs/heads/feature/available'])).not.toBe('');
    await expect(adapter.create({
      repositoryPath,
      destinationPath: join(root, 'managed', 'duplicate'),
      branch: 'refs/heads/feature/available',
    })).rejects.toMatchObject({ code: 'branch_already_checked_out' });

    writeFileSync(join(destinationPath, 'untracked.txt'), 'change\n');
    expect(await adapter.status(destinationPath)).toMatchObject({
      dirty: true,
      untrackedCount: 1,
    });

    await expect(adapter.remove(repositoryPath, destinationPath)).rejects.toBeInstanceOf(WorktreeGitError);
    rmSync(join(destinationPath, 'untracked.txt'));
    await adapter.remove(repositoryPath, destinationPath);
    expect(existsSync(destinationPath)).toBe(false);
  });

  test('rejects remote and missing local branches', async () => {
    const adapter = createWorktreeGitPort();

    await expect(adapter.create({
      repositoryPath,
      destinationPath: join(root, 'managed', 'remote'),
      branch: 'refs/remotes/origin/remote-only',
    })).rejects.toMatchObject({ code: 'branch_not_found' });
    await expect(adapter.create({
      repositoryPath,
      destinationPath: join(root, 'managed', 'missing'),
      branch: 'refs/heads/missing',
    })).rejects.toMatchObject({ code: 'branch_not_found' });
    await expect(adapter.status(join(root, 'missing'))).rejects.toMatchObject({
      code: 'worktree_missing',
    });
  });
});
