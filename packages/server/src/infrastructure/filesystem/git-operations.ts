import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdtemp, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { GitCommitInput, GitCommitResult, GitPushInput, GitPushPreviewInput, GitPushResult, GitRepositoryState } from '@prokopai/sdk';
import { clearGitStatusCache } from './git-status';
import { createSelectedCommitHooks } from './git-commit-hooks';

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function fail(message: string): never { throw new Error(`Git operation: ${message}`); }

export async function git(root: string, args: string[], options: { index?: string; input?: string | Buffer; allowFailure?: boolean } = {}): Promise<{ stdout: string; stdoutBytes: Buffer; code: number }> {
  const env = { ...process.env };
  // A host's Git invocation must not redirect this operation to another repository/index.
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_PAGER: 'cat', LC_ALL: 'C', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes' });
  if (options.index) env.GIT_INDEX_FILE = options.index;
  const { stdoutBytes, stderr, code } = await new Promise<{ stdoutBytes: Buffer; stderr: string; code: number }>((resolveResult, reject) => {
    const proc = spawn('git', ['--literal-pathspecs', '-C', root, ...args], {
      env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let bytes = 0;
    let failure: string | undefined;
    const stop = (message: string) => {
      failure = message;
      // Hooks and credential helpers may hold pipes open. Kill the process group
      // on POSIX and close our pipes so completion never waits on inherited handles.
      try {
        if (process.platform !== 'win32' && proc.pid) process.kill(-proc.pid, 'SIGKILL');
        else proc.kill('SIGKILL');
      } catch { proc.kill('SIGKILL'); }
      proc.stdout.destroy();
      proc.stderr.destroy();
      proc.stdin.destroy();
    };
    const timer = setTimeout(() => stop('command timed out. Refresh repository state before retrying.'), 120_000);
    const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) stop('output limit exceeded. Refresh repository state before retrying.');
      else chunks.push(chunk);
    };
    proc.stdout.on('data', collect(out));
    proc.stderr.on('data', collect(err));
    proc.stdin.on('error', () => {}); // Git may reject input before consuming it.
    proc.on('error', () => { clearTimeout(timer); reject(new Error('Git operation: could not start Git on the server.')); });
    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      if (failure) reject(new Error(`Git operation: ${failure}`));
      else resolveResult({ stdoutBytes: Buffer.concat(out), stderr: Buffer.concat(err).toString(), code: exitCode ?? 1 });
    });
    proc.stdin.end(options.input);
  });
  const stdout = stdoutBytes.toString();
  if (code !== 0 && !options.allowFailure) {
    // Never expose remote URLs, credential helper output, or arbitrary hook output.
    if (stderr.includes('Commit refused: a hook included files outside the selection.')) fail('a Git hook staged unchecked files. Adjust the hook or selection before committing.');
    if (/identity unknown|unable to auto-detect email/i.test(stderr)) fail('configure Git user.name and user.email on the server.');
    if (/signing failed|failed to sign/i.test(stderr)) fail('commit signing failed. Check the server Git signing configuration.');
    if (/non-fast-forward|stale info|fetch first|rejected/i.test(stderr + stdout)) fail('push rejected. The remote changed or is ahead; review it before retrying.');
    fail(`${args[0]} failed. Check Git hooks, credentials, permissions, and repository state on the server.`);
  }
  return { stdout, stdoutBytes, code };
}

export async function getGitRepository(root: string): Promise<GitRepositoryState> {
  await git(root, ['rev-parse', '--show-toplevel']);
  const branchResult = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true });
  const headResult = await git(root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
  const branch = branchResult.code === 0 ? branchResult.stdout.trim() : null;
  const remotes = (await git(root, ['remote'])).stdout.trim().split('\n').filter(Boolean);
  let upstream: GitRepositoryState['upstream'] = null;
  if (branch) {
    const remote = (await git(root, ['config', '--get', `branch.${branch}.remote`], { allowFailure: true })).stdout.trim();
    const ref = (await git(root, ['config', '--get', `branch.${branch}.merge`], { allowFailure: true })).stdout.trim();
    if (remotes.includes(remote) && ref.startsWith('refs/heads/')) upstream = { remote, branch: ref.slice(11) };
  }
  return { branch, head: headResult.code === 0 ? headResult.stdout.trim() : null, remotes, upstream };
}

async function checkExpected(root: string, input: { expectedBranch: string; expectedHead: string | null }): Promise<GitRepositoryState> {
  const state = await getGitRepository(root);
  if (!state.branch) fail('detached HEAD. Switch to a branch first.');
  if (state.branch !== input.expectedBranch || state.head !== input.expectedHead) fail('branch or HEAD changed. Refresh and review before retrying.');
  return state;
}

function validPath(path: string): void {
  if (!path || isAbsolute(path) || /^[A-Za-z]:/.test(path) || /[\0\\]/.test(path)
    || path.split('/').some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) fail('invalid file path.');
}

function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

async function checkPath(root: string, path: string): Promise<void> {
  validPath(path);
  const full = resolve(root, path);
  let parent = dirname(full);
  // Deleted directories have no realpath. Walk to the nearest existing parent.
  while (true) {
    try {
      if (!contained(await realpath(root), await realpath(parent))) fail('file parent escapes the selected root.');
      break;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const next = dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
  const entry = await lstat(full).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (entry && !entry.isFile() && !entry.isSymbolicLink()) fail('select files, not directories or submodules.');
}

export async function removeGitStagedAddition(root: string, path: string): Promise<{ path: string }> {
  root = await realpath(root);
  await checkPath(root, path);
  const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).stdout.replace(/\r?\n$/, '');
  const index = join(gitDir, 'index');
  const lockPath = `${index}.lock`;
  const lock = await open(lockPath, 'wx').catch(() => fail('index is locked. Wait for the other Git operation.'));
  let temp: string | undefined;
  let published = false;
  try {
    const state = await getGitRepository(root);
    if (state.head && (await git(root, ['ls-tree', '-z', state.head, '--', path])).stdout) fail('file exists in HEAD; only staged new files can be moved to untracked.');
    temp = await mkdtemp(join(gitDir, 'prokop-unstage-'));
    const privateIndex = join(temp, 'index');
    await copyFile(index, privateIndex);
    const entries = (await git(root, ['ls-files', '--stage', '-z', '--', path], { index: privateIndex })).stdout.split('\0').filter(Boolean);
    if (entries.length !== 1 || !/^[0-7]+ [a-f0-9]+ 0\t/.test(entries[0]) || entries[0].slice(entries[0].indexOf('\t') + 1) !== path) fail('select a staged new file without conflicts.');
    // --cached never touches disk. Force permits unstaging a new file whose
    // staged content differs from disk, including one deleted after staging.
    await git(root, ['rm', '--cached', '-f', '--', path], { index: privateIndex });
    const current = await getGitRepository(root);
    if (current.head !== state.head || current.branch !== state.branch) fail('HEAD changed. Refresh before moving this file to untracked.');
    await lock.writeFile(await readFile(privateIndex));
    await lock.sync();
    await lock.close();
    await rename(lockPath, index);
    published = true;
    return { path };
  } finally {
    await lock.close().catch(() => {});
    if (!published) await rm(lockPath, { force: true }).catch(() => {});
    if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
    clearGitStatusCache();
  }
}

export async function revertModifiedGitFile(root: string, path: string): Promise<{ path: string }> {
  root = await realpath(root);
  await checkPath(root, path);
  const repo = (await git(root, ['rev-parse', '--show-toplevel'])).stdout.replace(/\r?\n$/, '');
  const repoPath = relative(repo, resolve(root, path)).split(sep).join('/');
  const head = await git(repo, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
  if (head.code !== 0) fail('cannot revert a file before the first commit.');

  try {
    const records = (await git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', repoPath])).stdout.split('\0').filter(Boolean);
    if (records.length !== 1 || records[0].slice(3) !== repoPath) fail('file status changed. Refresh before reverting.');
    const [indexStatus, worktreeStatus] = records[0];
    const modified = (indexStatus === 'M' || indexStatus === 'T' || worktreeStatus === 'M' || worktreeStatus === 'T')
      && [indexStatus, worktreeStatus].every((status) => status === ' ' || status === 'M' || status === 'T');
    if (!modified) fail('only modified tracked files can be reverted.');

    await git(repo, ['restore', '--source=HEAD', '--staged', '--worktree', '--', repoPath]);
    return { path };
  } finally {
    clearGitStatusCache();
  }
}

export async function commitGitFiles(root: string, input: GitCommitInput): Promise<GitCommitResult> {
  root = await realpath(root);
  if (!input.message.trim() || input.message.length > 8192 || input.message.includes('\0')) fail('a commit message of at most 8192 characters is required.');
  if (!input.paths.length || input.paths.length > 5000) fail('select between 1 and 5000 files.');
  const paths = new Set(input.paths);
  await checkExpected(root, input);
  const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
  for (const sentinel of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG']) {
    if (await lstat(join(gitDir, sentinel)).then(() => true, () => false)) fail('finish the in-progress Git operation first.');
  }
  if ((await git(root, ['ls-files', '--unmerged', '-z'])).stdout) fail('resolve conflicts first.');
  // Include the source of a selected rename, but never a source outside this root.
  const repo = (await git(root, ['rev-parse', '--show-toplevel'])).stdout.trim();
  const records = (await git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    if (record.slice(0, 2).includes('R') || record.slice(0, 2).includes('C')) {
      const old = records[++i];
      const destination = relative(root, resolve(repo, record.slice(3))).split(sep).join('/');
      if (record.slice(0, 2).includes('R') && paths.has(destination)) paths.add(relative(root, resolve(repo, old)).split(sep).join('/'));
    }
  }
  for (const path of paths) await checkPath(root, path);
  const index = join(gitDir, 'index');
  const lockPath = `${index}.lock`;
  const lock = await open(lockPath, 'wx').catch(() => fail('index is locked. Wait for the other Git operation to finish.'));
  let temp: string | undefined;
  let published = false;
  let committedHead: string | undefined;
  try {
    temp = await mkdtemp(join(gitDir, 'prokop-commit-'));
    const privateIndex = join(temp, 'index');
    await copyFile(index, privateIndex).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
    const pathspec = [...paths].map((path) => `${path}\0`).join('');
    const indexed = new Set((await git(root, ['ls-files', '-z'], { index: privateIndex })).stdout.split('\0'));
    const stagePaths: string[] = [];
    for (const path of paths) {
      // A staged deletion is already absent from the private index. git add
      // rejects that path, but commit --only still needs it to remove HEAD's entry.
      if (indexed.has(path) || await lstat(resolve(root, path)).then(() => true, () => false)) stagePaths.push(path);
    }
    if (stagePaths.length) await git(root, ['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      index: privateIndex, input: stagePaths.map((path) => `${path}\0`).join(''),
    });
    const pathspecFile = join(temp, 'paths');
    await Bun.write(pathspecFile, pathspec);
    const configuredHooks = (await git(root, ['config', '--path', '--get', 'core.hooksPath'], { allowFailure: true })).stdout.replace(/\r?\n$/, '');
    const commonDir = resolve(root, (await git(root, ['rev-parse', '--git-common-dir'])).stdout.replace(/\r?\n$/, ''));
    const originalHooks = configuredHooks ? resolve(repo, configuredHooks) : join(commonDir, 'hooks');
    const hooks = await createSelectedCommitHooks(temp, originalHooks, [...paths].map((path) => relative(repo, resolve(root, path)).split(sep).join('/')), input.runHooks !== false);
    await checkExpected(root, input);
    try {
      await git(root, ['-c', `core.hooksPath=${hooks}`, 'commit', '--only', '--file=-', `--pathspec-from-file=${pathspecFile}`, '--pathspec-file-nul'], { index: privateIndex, input: input.message });
    } catch (error: unknown) {
      // A post-commit failure/timeout can occur after HEAD advanced. Never invite a duplicate commit.
      const current = await getGitRepository(root);
      if (current.head === input.expectedHead || !current.head) throw error;
      committedHead = current.head;
      return { head: current.head, warning: `HEAD advanced, but Git did not finish cleanly. Review the commit and index on the server. Recovery files remain at ${temp}.` };
    }
    committedHead = (await getGitRepository(root)).head ?? undefined;
    if (!committedHead) fail('unable to read the new commit. Inspect the repository before retrying.');
    await lock.writeFile(await readFile(privateIndex));
    await lock.sync();
    await lock.close();
    await rename(lockPath, index);
    published = true;
    return { head: committedHead };
  } catch (error: unknown) {
    if (committedHead) return { head: committedHead, warning: `Commit created, but index update failed. Review the index on the server. Recovery files remain at ${temp}.` };
    throw error;
  } finally {
    await lock.close().catch(() => {});
    const needsRecovery = committedHead !== undefined && !published;
    // Preserve the private index and lock for manual recovery after a partial success.
    if (!published && !needsRecovery) await rm(lockPath, { force: true }).catch(() => {});
    if (temp && !needsRecovery) await rm(temp, { recursive: true, force: true }).catch(() => {});
    clearGitStatusCache();
  }
}

async function validateDestination(root: string, input: GitPushPreviewInput): Promise<void> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(input.remote) || !(await getGitRepository(root)).remotes.includes(input.remote)) fail('choose a configured remote.');
  if (!input.branch || input.branch.startsWith('-') || /[\0\r\n]/.test(input.branch)
    || (await git(root, ['check-ref-format', `refs/heads/${input.branch}`], { allowFailure: true })).code !== 0) fail('invalid destination branch.');
  // Multiple push URLs can partially succeed and defeat a single reviewed lease.
  const urls = (await git(root, ['remote', 'get-url', '--push', '--all', input.remote])).stdout.trim().split('\n');
  if (urls.length !== 1) fail('multiple push URLs are not supported.');
  if ((await git(root, ['config', '--bool', '--get', `remote.${input.remote}.mirror`], { allowFailure: true })).stdout.trim() === 'true') fail('mirror remotes are not supported.');
}

export async function previewGitPush(root: string, input: GitPushPreviewInput): Promise<{ remoteHead: string | null }> {
  await validateDestination(root, input);
  const url = (await git(root, ['remote', 'get-url', '--push', input.remote])).stdout.trim();
  const result = await git(root, ['ls-remote', '--refs', '--', url, `refs/heads/${input.branch}`]);
  const line = result.stdout.split('\n').find((row) => row.split('\t')[1] === `refs/heads/${input.branch}`);
  const remoteHead = line?.split('\t')[0] ?? null;
  if (remoteHead !== null && !SHA.test(remoteHead)) fail('invalid remote response.');
  return { remoteHead };
}

export async function pushGitBranch(root: string, input: GitPushInput): Promise<GitPushResult> {
  if (!SHA.test(input.expectedHead)) fail('invalid local commit.');
  await checkExpected(root, input);
  await validateDestination(root, input);
  if (input.force && (input.expectedRemoteHead === undefined || (input.expectedRemoteHead !== null && !SHA.test(input.expectedRemoteHead)))) fail('force push requires an explicit reviewed remote commit.');
  if (input.force && (await previewGitPush(root, input)).remoteHead !== input.expectedRemoteHead) fail('push rejected. The remote changed since confirmation.');
  const args = ['-c', 'push.followTags=false', 'push', '--porcelain', '--no-follow-tags'];
  if (input.force) args.push(`--force-with-lease=refs/heads/${input.branch}:${input.expectedRemoteHead ?? ''}`);
  // Push the reviewed SHA, never a branch that could advance while credentials/hooks run.
  args.push('--', input.remote, `${input.expectedHead}:refs/heads/${input.branch}`);
  await git(root, args);
  if (input.setUpstream) {
    try {
      await checkExpected(root, input);
      await git(root, ['config', `branch.${input.expectedBranch}.remote`, input.remote]);
      await git(root, ['config', `branch.${input.expectedBranch}.merge`, `refs/heads/${input.branch}`]);
    } catch {
      return { head: input.expectedHead, warning: 'Push succeeded, but upstream configuration failed. Configure the upstream on the server.' };
    }
  }
  return { head: input.expectedHead };
}
