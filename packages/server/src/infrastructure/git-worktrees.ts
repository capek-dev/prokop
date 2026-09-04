import { createHash } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { GitWorktreeRef } from '@prokopai/sdk';
import type {
  WorktreeGitPort,
  WorktreeGitStatus,
} from '@/application/ports/worktree';

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const GIT_TIMEOUT_MS = 30_000;
const GIT_OUTPUT_LIMIT_BYTES = 1024 * 1024;

export type WorktreeGitFailureCode =
  | 'git_not_installed'
  | 'not_a_git_repository'
  | 'invalid_branch_name'
  | 'branch_not_found'
  | 'branch_already_checked_out'
  | 'worktree_missing'
  | 'operation_timed_out'
  | 'output_limit'
  | 'git_error';

export class WorktreeGitError extends Error {
  constructor(
    readonly code: WorktreeGitFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorktreeGitError';
  }
}

async function readLimited(
  stream: ReadableStream<Uint8Array>,
  process: ReturnType<typeof Bun.spawn>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > GIT_OUTPUT_LIMIT_BYTES) {
        process.kill();
        throw new WorktreeGitError('output_limit', 'Git output exceeded the allowed limit');
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function runGit(cwd: string, args: string[]): Promise<GitResult> {
  let process: ReturnType<typeof Bun.spawn>;
  try {
    process = Bun.spawn(['git', '-C', cwd, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...Bun.env,
        LC_ALL: 'C',
        GIT_TERMINAL_PROMPT: '0',
      },
    });
  } catch (error: unknown) {
    throw new WorktreeGitError(
      'git_not_installed',
      error instanceof Error ? error.message : 'Git is not installed',
    );
  }

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    process.kill();
  }, GIT_TIMEOUT_MS);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readLimited(process.stdout as ReadableStream<Uint8Array>, process),
      readLimited(process.stderr as ReadableStream<Uint8Array>, process),
      process.exited,
    ]);
    if (timedOut) {
      throw new WorktreeGitError('operation_timed_out', 'Git operation timed out');
    }
    return { stdout, stderr, exitCode };
  } catch (error: unknown) {
    process.kill();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function requireSuccess(result: GitResult, code: WorktreeGitFailureCode = 'git_error'): string {
  if (result.exitCode !== 0) {
    throw new WorktreeGitError(code, (result.stderr || result.stdout || 'Git operation failed').trim());
  }
  return result.stdout;
}

function checkedOutBranches(output: string): Set<string> {
  return new Set(
    output
      .split('\n')
      .filter((line) => line.startsWith('branch refs/heads/'))
      .map((line) => line.slice('branch '.length)),
  );
}

async function readStatus(path: string): Promise<WorktreeGitStatus> {
  try {
    await realpath(path);
  } catch {
    throw new WorktreeGitError('worktree_missing', 'Worktree directory is missing');
  }

  const [statusResult, branchResult, headResult] = await Promise.all([
    // --ignore-submodules=none makes modified or untracked content inside
    // submodules count as dirty, so removal cannot silently destroy data
    // that only exists in a submodule clone (worktrees with submodules are
    // removed with rm -rf, which has no git-level safety net).
    runGit(path, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignore-submodules=none']),
    runGit(path, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    runGit(path, ['rev-parse', '--verify', 'HEAD']),
  ]);
  const output = requireSuccess(statusResult);
  const entries = output.split('\0').filter(Boolean);
  return {
    branch: branchResult.exitCode === 0 ? branchResult.stdout.trim() || null : null,
    head: headResult.exitCode === 0 ? headResult.stdout.trim() || null : null,
    dirty: entries.length > 0,
    untrackedCount: entries.filter((entry) => entry.startsWith('? ')).length,
  };
}

export function createWorktreeGitPort(): WorktreeGitPort {
  return {
    async inspectRepository(path) {
      const [commonDirResult, topLevelResult] = await Promise.all([
        runGit(path, [
          'rev-parse',
          '--path-format=absolute',
          '--git-common-dir',
        ]),
        runGit(path, ['rev-parse', '--show-toplevel']),
      ]);
      const commonDir = requireSuccess(commonDirResult, 'not_a_git_repository').trim();
      const topLevel = requireSuccess(topLevelResult, 'not_a_git_repository').trim();
      const [repositoryRoot, repositoryTopLevel, selectedRoot] = await Promise.all([
        realpath(resolve(commonDir)),
        realpath(resolve(topLevel)),
        realpath(resolve(path)),
      ]);
      return {
        repositoryId: createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 24),
        repositoryRoot,
        repositoryTopLevel,
        selectedRoot,
      };
    },

    async listRefs(path) {
      const [refsResult, currentResult, worktreesResult] = await Promise.all([
        runGit(path, [
          'for-each-ref',
          '--format=%(refname)%09%(objectname)%09%(symref)',
          'refs/heads',
        ]),
        runGit(path, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
        runGit(path, ['worktree', 'list', '--porcelain']),
      ]);
      const current = currentResult.exitCode === 0 ? currentResult.stdout.trim() : null;
      const checkedOut = checkedOutBranches(requireSuccess(worktreesResult));
      return requireSuccess(refsResult, 'not_a_git_repository')
        .split('\n')
        .filter(Boolean)
        .flatMap((line): GitWorktreeRef[] => {
          const [fullName, commit, symbolicTarget] = line.split('\t');
          if (!fullName || !commit || symbolicTarget || !fullName.startsWith('refs/heads/')) {
            return [];
          }
          const name = fullName.slice('refs/heads/'.length);
          return [{
            name,
            ref: fullName,
            kind: 'local',
            commit,
            current: name === current,
            checkedOut: checkedOut.has(fullName),
          }];
        })
        .sort((left, right) => Number(left.checkedOut) - Number(right.checkedOut)
          || Number(right.current) - Number(left.current)
          || left.name.localeCompare(right.name));
    },

    async create({ repositoryPath, destinationPath, branch }) {
      if (!branch.startsWith('refs/heads/')) {
        throw new WorktreeGitError('branch_not_found', 'Only local branches can be used');
      }
      const branchExists = (await runGit(repositoryPath, [
        'show-ref',
        '--verify',
        '--quiet',
        branch,
      ])).exitCode === 0;
      if (!branchExists) {
        throw new WorktreeGitError('branch_not_found', `Local branch not found: ${branch}`);
      }
      const worktrees = checkedOutBranches(requireSuccess(
        await runGit(repositoryPath, ['worktree', 'list', '--porcelain']),
      ));
      if (worktrees.has(branch)) {
        throw new WorktreeGitError(
          'branch_already_checked_out',
          `Branch is already checked out in another worktree: ${branch.slice('refs/heads/'.length)}`,
        );
      }
      await mkdir(dirname(destinationPath), { recursive: true });
      const branchName = branch.slice('refs/heads/'.length);
      const result = await runGit(repositoryPath, ['worktree', 'add', destinationPath, branchName]);
      if (result.exitCode !== 0 && /already (?:checked out|used by worktree)/i.test(result.stderr)) {
        throw new WorktreeGitError(
          'branch_already_checked_out',
          `Branch is already checked out in another worktree: ${branch.slice('refs/heads/'.length)}`,
        );
      }
      requireSuccess(result);
      return readStatus(destinationPath);
    },

    async status(path) {
      return readStatus(path);
    },

    async remove(repositoryPath, worktreePath) {
      const result = await runGit(repositoryPath, ['worktree', 'remove', worktreePath]);
      if (result.exitCode === 0) return;
      // git refuses to move or remove worktrees containing submodules, even
      // with --force (validate_no_submodules is unconditional). Fall back to
      // removing the directory and pruning the admin record; the record's
      // .git dir also holds the worktree's submodule gitdirs, so nothing is
      // left behind. Only reached after the dirty check passed, so the tree
      // holds no unrecoverable untracked data.
      if (!/submodules? (?:cannot be moved or removed|is required) /i.test(`${result.stderr}\n${result.stdout}`)
        && !/working trees? containing submodules? cannot be moved or removed/i.test(
          `${result.stderr}\n${result.stdout}`,
        )) {
        throw new WorktreeGitError('git_error', (result.stderr || result.stdout || 'Git worktree removal failed').trim());
      }
      try {
        await rm(worktreePath, { recursive: true, force: true, maxRetries: 5 });
        await requireSuccess(await runGit(repositoryPath, ['worktree', 'prune']));
      } catch (error: unknown) {
        if (error instanceof WorktreeGitError) throw error;
        throw new WorktreeGitError(
          'git_error',
          error instanceof Error ? error.message : 'Removing the submodule worktree failed',
        );
      }
    },
  };
}
