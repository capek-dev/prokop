import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { git } from './git-operations';
import { clearGitStatusCache } from './git-status';

const operations = new Map<string, Promise<void>>();

/** Serialize branch and rebase actions across worktrees sharing refs. */
export async function withGitActionLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const commonDir = await realpath(resolve(root, (await git(root, ['rev-parse', '--git-common-dir'])).stdout.replace(/\r?\n$/, '')));
  const prior = operations.get(commonDir) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((done) => { release = done; });
  operations.set(commonDir, next);
  await prior;
  try {
    return await action();
  } finally {
    clearGitStatusCache();
    release();
    if (operations.get(commonDir) === next) operations.delete(commonDir);
  }
}
