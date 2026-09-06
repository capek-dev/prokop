import { realpath } from 'node:fs/promises';
import { git } from './git-operations';

/** Include the base checkout and every intermediate replay tree, not just final diff. */
export async function assertRebaseFilesSafe(root: string, base: string, head: string, allowTrackedChanges = false): Promise<void> {
  const top = (await git(root, ['rev-parse', '--show-toplevel'])).stdout.trim();
  if (await realpath(root) !== await realpath(top)) throw new Error('Git operation: select the repository root before rebasing.');
  if (!allowTrackedChanges && (await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=no'])).stdout) throw new Error('Git operation: commit or move tracked and staged changes before rebasing.');
  const untracked = [
    ...(await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout.split('\0'),
    ...(await git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'])).stdout.split('\0'),
  ].filter(Boolean).map((p) => p.replace(/\/$/, '').toLowerCase());
  if (!untracked.length) return;
  const commits = (await git(root, ['rev-list', `${base}..${head}`, '--'])).stdout.trim().split('\n').filter(Boolean);
  const touched = new Set((await git(root, ['ls-tree', '-r', '--name-only', '-z', base])).stdout.split('\0').filter(Boolean));
  // Bound expensive histories and fail closed instead of guessing collision safety.
  if (commits.length > 1000) throw new Error('Git operation: move untracked/ignored files before rebasing more than 1000 commits.');
  for (const commit of commits) {
    for (const path of (await git(root, ['diff-tree', '--root', '-m', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', commit])).stdout.split('\0').filter(Boolean)) touched.add(path);
  }
  for (const raw of touched) {
    const path = raw.toLowerCase();
    if (untracked.some((local) => path === local || path.startsWith(`${local}/`) || local.startsWith(`${path}/`))) {
      throw new Error('Git operation: move colliding untracked or ignored files before rebasing.');
    }
  }
}
