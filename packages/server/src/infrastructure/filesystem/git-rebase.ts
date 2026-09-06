import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitRebaseState, GitRebaseStart } from '@prokopai/sdk';
import { git, getGitRepository } from './git-operations';
import { withGitActionLock } from './git-action-lock';
import { assertRebaseFilesSafe } from './git-rebase-preflight';

/** Internal unlocked read, callers must hold the shared Git action lock. */
export async function readGitRebaseState(root: string): Promise<GitRebaseState> { return readState(root); }
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function fail(message: string): never { throw new Error(`Git operation: ${message}`); }
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
async function gitDir(root: string): Promise<string> {
  return (await git(root, ['rev-parse', '--absolute-git-dir'])).stdout.replace(/\r?\n$/, '');
}
async function readState(root: string): Promise<GitRebaseState> {
  if ((await git(root, ['rev-parse', '--show-prefix'])).stdout.trim()) fail('select the repository root before managing a rebase.');
  const dir = await gitDir(root);
  const merge = join(dir, 'rebase-merge');
  const apply = join(dir, 'rebase-apply');
  const stateDir = await exists(merge) ? merge : await exists(apply) ? apply : null;
  if (!stateDir) return { active: false, token: null, branch: null, originalHead: null, onto: null, conflicts: [] };
  // git am uses rebase-apply too; it is not a rebase lifecycle we may continue/abort.
  if (stateDir === apply && !await exists(join(apply, 'rebasing'))) fail('an apply operation is active, not a rebase. Finish it on the server.');
  const [branchRef, originalHead, onto] = await Promise.all(['head-name', 'orig-head', 'onto'].map(async (name) => (await readFile(join(stateDir, name), 'utf8')).trim()));
  const unmerged = (await git(root, ['ls-files', '--unmerged', '-z'])).stdout;
  const conflicts = [...new Set(unmerged.split('\0').filter(Boolean).map((entry) => entry.slice(entry.indexOf('\t') + 1)))];
  const hash = createHash('sha256');
  hash.update(JSON.stringify([stateDir, branchRef, originalHead, onto]));
  // Include sequencer progress even when consecutive stops have the same HEAD.
  for (const name of ['done', 'git-rebase-todo', 'stopped-sha', 'next', 'last', 'prokop-stop']) {
    const path = join(stateDir, name);
    if (await exists(path)) hash.update(await readFile(path));
  }
  hash.update((await git(root, ['rev-parse', 'HEAD'])).stdout);
  // Hash staged content/modes, not index stat-cache bytes changed by git status.
  hash.update((await git(root, ['ls-files', '--stage', '-z'])).stdout);
  hash.update((await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--binary', '--no-color', '--'])).stdout);
  return { active: true, token: hash.digest('hex'), branch: branchRef.startsWith('refs/heads/') ? branchRef.slice(11) : null, originalHead, onto, conflicts };
}

async function recordStop(root: string): Promise<void> {
  const dir = join(await gitDir(root), 'rebase-merge');
  if (!await exists(dir)) return;
  const replay = await git(root, ['rev-parse', '--verify', 'REBASE_HEAD'], { allowFailure: true });
  if (replay.code) return;
  const checkpoint = join(dir, 'prokop-stop');
  // A retry at the same stop must not mistake an already-created empty commit for its parent.
  if (await exists(checkpoint) && (await readFile(checkpoint, 'utf8')).trim().split('\n')[1] === replay.stdout.trim()) return;
  const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  // A checkpoint only for preserving empty resolved commits, never lifecycle authority.
  await writeFile(join(dir, 'prokop-stop'), `${head}\n${replay.stdout.trim()}\n`);
}

async function preserveEmptyResolution(root: string): Promise<void> {
  const dir = join(await gitDir(root), 'rebase-merge');
  if (!await exists(join(dir, 'stopped-sha'))) return;
  if ((await git(root, ['diff', '--cached', '--quiet'], { allowFailure: true })).code !== 0) return;
  if ((await git(root, ['diff', '--quiet'], { allowFailure: true })).code !== 0) fail('stage or discard tracked edits before continuing.');
  if (!await exists(join(dir, 'prokop-stop'))) fail('empty resolution from an external rebase: finish the rebase on the server, or Abort here.');
  const [pausedHead, replay] = (await readFile(join(dir, 'prokop-stop'), 'utf8')).trim().split('\n');
  if (!SHA.test(pausedHead) || !SHA.test(replay)) fail('invalid rebase checkpoint. Recover it on the server.');
  const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  if (head !== pausedHead) return; // A manual commit already completed this stop.
  if ((await git(root, ['rev-parse', 'REBASE_HEAD'])).stdout.trim() !== replay) fail('replayed commit changed. Refresh before continuing.');
  await git(root, ['commit', '--allow-empty', '-C', replay]);
}

export async function getGitRebaseState(root: string): Promise<GitRebaseState> {
  return withGitActionLock(root, () => readState(root));
}

export async function startGitRebase(root: string, input: GitRebaseStart): Promise<GitRebaseState> {
  return withGitActionLock(root, async () => {
    if (!SHA.test(input.expectedHead) || !SHA.test(input.baseHead)) fail('invalid reviewed commit SHA.');
    for (const branch of [input.expectedBranch, input.baseBranch]) {
      if (!branch || branch.startsWith('-') || (await git(root, ['check-ref-format', `refs/heads/${branch}`], { allowFailure: true })).code) fail('choose a valid local branch.');
    }
    if (input.expectedBranch === input.baseBranch) fail('choose a different local base branch.');
    const dir = await gitDir(root);
    for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG']) {
      if (await exists(join(dir, name))) fail('finish the in-progress Git operation before rebasing.');
    }
    const repository = await getGitRepository(root);
    if (repository.branch !== input.expectedBranch || repository.head !== input.expectedHead) fail('checkout changed. Review the rebase again.');
    const base = await git(root, ['rev-parse', '--verify', `refs/heads/${input.baseBranch}`], { allowFailure: true });
    if (base.code || base.stdout.trim() !== input.baseHead) fail('local base branch changed or is unavailable. Review the rebase again.');
    await assertRebaseFilesSafe(root, input.baseHead, input.expectedHead);
    // Pin the local tip and override settings that could stash work or move other refs.
    const result = await git(root, ['-c', 'rebase.autoStash=false', '-c', 'rebase.updateRefs=false', '-c', 'rebase.autoSquash=false', '-c', 'rerere.enabled=false', 'rebase', '--merge', '--no-autostash', '--no-update-refs', '--no-autosquash', '--no-fork-point', '--no-rebase-merges', '--reapply-cherry-picks', '--keep-empty', '--empty=keep', '--', input.baseHead], { allowFailure: true });
    await recordStop(root);
    const state = await readState(root);
    if (result.code && !state.active) fail('rebase could not start. Check Git configuration and hooks on the server.');
    return state;
  });
}

export async function controlGitRebase(root: string, input: { action: 'continue' | 'abort'; token: string }): Promise<GitRebaseState> {
  return withGitActionLock(root, async () => {
    if (input.action !== 'continue' && input.action !== 'abort') fail('invalid rebase action.');
    const state = await readState(root);
    if (!state.active || !input.token || state.token !== input.token) fail('rebase changed. Refresh before continuing or aborting.');
    if (input.action === 'continue' && state.conflicts.length) fail('resolve and stage every conflict before continuing.');
    if (!state.originalHead || !state.onto || !SHA.test(state.originalHead) || !SHA.test(state.onto)) fail('invalid rebase state. Recover it on the server.');
    // Files created while paused must survive both replay and abort's reset.
    await assertRebaseFilesSafe(root, input.action === 'abort' ? state.originalHead : state.onto, state.originalHead, true);
    if ((await readState(root)).token !== input.token) fail('rebase changed. Refresh before continuing or aborting.');
    // Continue never stages files. Preserve empty resolutions instead of Git's implicit skip.
    if (input.action === 'continue') await preserveEmptyResolution(root);
    const result = await git(root, ['-c', 'rebase.updateRefs=false', '-c', 'rerere.enabled=false', 'rebase', `--${input.action}`], { allowFailure: true });
    if (input.action === 'continue') await recordStop(root);
    const next = await readState(root);
    if (result.code && (input.action === 'abort' || !next.conflicts.length)) fail(`rebase ${input.action} failed. Refresh state and check Git configuration on the server.`);
    return next;
  });
}
