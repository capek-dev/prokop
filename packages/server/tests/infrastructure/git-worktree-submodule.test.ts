import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorktreeGitPort } from '@/infrastructure/git-worktrees';

const git = createWorktreeGitPort();

let root: string;

async function run(cmd: string[], cwd: string): Promise<string> {
  const process = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${cmd.join(' ')} failed: ${stderr || stdout}`);
  return stdout;
}

/** Main repo with a feature branch containing one submodule at vendor/sub. */
async function fixture(name: string, branch: string): Promise<{ mainRepo: string; subRepo: string }> {
  const mainRepo = join(root, `${name}-main`);
  const subRepo = join(root, `${name}-sub`);
  for (const dir of [mainRepo, subRepo]) {
    await mkdir(dir, { recursive: true });
    await run(['git', 'init', '--initial-branch=main'], dir);
    await run(['git', 'config', 'user.email', 'test@example.com'], dir);
    await run(['git', 'config', 'user.name', 'Test'], dir);
  }
  await writeFile(join(subRepo, 'lib.txt'), 'submodule\n');
  await run(['git', 'add', '.'], subRepo);
  await run(['git', 'commit', '-m', 'sub init'], subRepo);

  await writeFile(join(mainRepo, 'README.md'), '# main\n');
  await run(['git', 'add', '.'], mainRepo);
  await run(['git', 'commit', '-m', 'init'], mainRepo);
  await run(['git', 'checkout', '-b', branch], mainRepo);
  await run(
    ['git', '-c', 'protocol.file.allow=always', 'submodule', 'add', subRepo, 'vendor/sub'],
    mainRepo,
  );
  await run(['git', 'commit', '-m', 'add submodule'], mainRepo);
  await run(['git', 'checkout', 'main'], mainRepo);
  return { mainRepo, subRepo };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'worktree-submodule-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

describe('worktree git port submodule removal', () => {
  test.skipIf(!Bun.which('git'))('removes a worktree containing submodules via rm+prune fallback', async () => {
    const { mainRepo } = await fixture('clean', 'feature/sub');
    const worktreePath = join(root, 'worktree-clean');
    await git.create({
      repositoryPath: mainRepo,
      destinationPath: worktreePath,
      branch: 'refs/heads/feature/sub',
    });
    await run(
      ['git', '-c', 'protocol.file.allow=always', 'submodule', 'update', '--init'],
      worktreePath,
    );

    // Plain git refuses (validate_no_submodules is unconditional); the port
    // falls back to rm + prune.
    await git.remove(mainRepo, worktreePath);

    const list = await run(['git', 'worktree', 'list', '--porcelain'], mainRepo);
    expect(list).not.toContain(worktreePath);
    const refs = await git.listRefs(mainRepo);
    expect(refs.find((ref) => ref.name === 'feature/sub')?.checkedOut).toBe(false);
  });

  test.skipIf(!Bun.which('git'))('blocks removal when a submodule has uncommitted changes', async () => {
    const { mainRepo } = await fixture('dirty', 'feature/sub-dirty');
    const worktreePath = join(root, 'worktree-dirty');
    await git.create({
      repositoryPath: mainRepo,
      destinationPath: worktreePath,
      branch: 'refs/heads/feature/sub-dirty',
    });
    await run(
      ['git', '-c', 'protocol.file.allow=always', 'submodule', 'update', '--init'],
      worktreePath,
    );

    // Untracked file inside the submodule clone: only visible with
    // --ignore-submodules=none. git reports it as a modified submodule
    // entry rather than an untracked path, so the requirement is that the
    // tree reads dirty and removal stays blocked.
    await writeFile(join(worktreePath, 'vendor', 'sub', 'untracked.txt'), 'precious\n');

    await expect(git.status(worktreePath)).resolves.toMatchObject({ dirty: true });
  });
});
