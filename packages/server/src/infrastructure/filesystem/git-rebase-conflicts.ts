import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { GitRebaseConflict, GitRebaseResolution, GitRebaseSide, GitRebaseState } from '@prokopai/sdk';
import { git } from './git-operations';
import { withGitActionLock } from './git-action-lock';
import { readGitRebaseState } from './git-rebase';

const LIMIT = 1024 * 1024;
function fail(message: string): never { throw new Error(`Git operation: ${message}`); }
function text(bytes: Buffer): string | null {
  const value = bytes.toString('utf8');
  return bytes.includes(0) || !Buffer.from(value).equals(bytes) ? null : value;
}
async function safePath(root: string, path: string): Promise<void> {
  if (!path || isAbsolute(path) || /^[A-Za-z]:/.test(path) || /[\0\\]/.test(path)
    || path.split('/').some((p) => !p || p === '.' || p === '..' || p.toLowerCase() === '.git')) fail('invalid conflict path.');
  let current = root;
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    const entry = await lstat(current).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (entry && (entry.isSymbolicLink() || (i < parts.length - 1 ? !entry.isDirectory() : !entry.isFile()))) fail('symlink, directory and submodule conflicts require resolution on the server.');
  }
}
async function workingBytes(root: string, path: string): Promise<Buffer | null> {
  await safePath(root, path);
  const file = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (!file) return null;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > LIMIT) fail('conflict exceeds the 1 MiB editor limit. Resolve it on the server.');
    return await file.readFile();
  } finally { await file.close(); }
}
interface Stage { mode: string; sha: string; stage: number }
async function inspect(root: string, path: string): Promise<{ conflict: GitRebaseConflict; stages: Stage[]; state: GitRebaseState }> {
  const state = await readGitRebaseState(root);
  if (!state.active || !state.conflicts.includes(path)) fail('select a current rebase conflict.');
  const bytes = await workingBytes(root, path);
  const output = (await git(root, ['ls-files', '--unmerged', '-z', '--', path])).stdout;
  const stages = output.split('\0').filter(Boolean).map((entry) => {
    const match = /^(100644|100755) ([a-f0-9]{40}|[a-f0-9]{64}) ([123])\t/.exec(entry);
    if (!match || entry.slice(match[0].length) !== path) fail('unsupported conflict mode. Resolve it on the server.');
    return { mode: match[1], sha: match[2], stage: Number(match[3]) };
  });
  const side = async (stage: number): Promise<GitRebaseSide | null> => {
    const entry = stages.find((s) => s.stage === stage);
    if (!entry) return null;
    if (Number((await git(root, ['cat-file', '-s', entry.sha])).stdout) > LIMIT) fail('conflict exceeds the 1 MiB editor limit. Resolve it on the server.');
    const value = text((await git(root, ['cat-file', 'blob', entry.sha])).stdoutBytes);
    return { text: value, binary: value === null, mode: entry.mode };
  };
  const token = createHash('sha256').update(JSON.stringify([state.token, path, output, bytes === null])).update(bytes ?? Buffer.alloc(0)).digest('hex');
  return { state, stages, conflict: { path, token, base: await side(2), feature: await side(3), original: await side(1), workingText: bytes === null ? null : text(bytes) } };
}
export async function getGitRebaseConflict(root: string, path: string): Promise<GitRebaseConflict> {
  return withGitActionLock(root, async () => (await inspect(await realpath(root), path)).conflict);
}
export async function resolveGitRebaseConflict(root: string, input: GitRebaseResolution): Promise<GitRebaseState> {
  return withGitActionLock(root, async () => {
    root = await realpath(root);
    const { conflict, stages } = await inspect(root, input.path);
    if (!input.token || input.token !== conflict.token) fail('conflict changed. Refresh before resolving.');
    if (!['text', 'base', 'feature', 'delete'].includes(input.resolution)) fail('invalid resolution.');
    let bytes: Buffer | null = null;
    let mode = stages.find((s) => s.stage === 2)?.mode ?? stages.find((s) => s.stage === 3)?.mode ?? '100644';
    if (input.resolution === 'text') {
      if (typeof input.text !== 'string' || Buffer.byteLength(input.text) > LIMIT || text(Buffer.from(input.text)) !== input.text) fail('provide valid UTF-8 text of at most 1 MiB.');
      if (conflict.base?.binary || conflict.feature?.binary) fail('choose a side for a binary conflict.');
      bytes = Buffer.from(input.text);
    } else if (input.resolution !== 'delete') {
      const entry = stages.find((s) => s.stage === (input.resolution === 'base' ? 2 : 3));
      if (entry) {
        mode = entry.mode;
        bytes = (await git(root, ['cat-file', 'blob', entry.sha])).stdoutBytes;
      }
    }
    const dir = (await git(root, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
    const index = join(dir, 'index');
    const lockPath = `${index}.lock`;
    const lock = await open(lockPath, 'wx').catch(() => fail('index is locked. Wait for the other Git operation.'));
    let temp: string | undefined;
    let published = false;
    try {
      temp = await mkdtemp(join(dir, 'prokop-rebase-'));
      const privateIndex = join(temp, 'index');
      await copyFile(index, privateIndex);
      const zero = '0'.repeat(stages[0].sha.length);
      let info = `0 ${zero}\t${input.path}\0`;
      if (bytes !== null) {
        const sha = (await git(root, ['hash-object', '-w', '--stdin'], { input: bytes })).stdout.trim();
        info += `${mode} ${sha}\t${input.path}\0`;
      }
      await git(root, ['update-index', '-z', '--index-info'], { index: privateIndex, input: info });
      if ((await inspect(root, input.path)).conflict.token !== input.token) fail('conflict changed. Refresh before resolving.');
      await safePath(root, input.path);
      const full = join(root, input.path);
      if (bytes === null) await unlink(full).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
      else {
        await mkdir(dirname(full), { recursive: true });
        // Rename a sibling file instead of truncating a possibly hard-linked target.
        const sibling = await mkdtemp(join(dirname(full), '.prokop-resolution-'));
        try {
          const replacement = join(sibling, 'result');
          const file = await open(replacement, 'wx', mode === '100755' ? 0o755 : 0o644);
          try { await file.writeFile(bytes); await file.chmod(mode === '100755' ? 0o755 : 0o644); await file.sync(); }
          finally { await file.close(); }
          await safePath(root, input.path);
          await rename(replacement, full);
        } finally { await rm(sibling, { recursive: true, force: true }); }
      }
      await lock.writeFile(await readFile(privateIndex));
      await lock.sync();
      await lock.close();
      await rename(lockPath, index);
      published = true;
    } finally {
      await lock.close().catch(() => {});
      if (!published) await rm(lockPath, { force: true });
      if (temp) await rm(temp, { recursive: true, force: true });
    }
    return readGitRebaseState(root);
  });
}
