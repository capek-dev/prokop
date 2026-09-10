import { lstat, mkdir, mkdtemp, open, readdir, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { withKnowledgeMutationLock } from '@capekai/core/hosts';
import type { KnowledgeFilePort } from '@/application/learning/knowledge-journal';
import type { KnowledgeSnapshot, KnowledgeStagingPort } from '@/application/learning/knowledge-staging';

const MAX_BYTES = 1_048_576;

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Check every existing component, including root ancestors, without following links. */
async function validatePath(path: string): Promise<void> {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  if (parent !== absolute) await validatePath(parent);
  try {
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error('Learning knowledge paths cannot contain symlinks');
  } catch (error: unknown) {
    if (!missing(error)) throw error;
  }
}

function validName(kind: 'memory' | 'skills', path: string): boolean {
  return kind === 'memory'
    ? path === 'USER.md' || path === 'MEMORY.md'
    : /^[a-zA-Z0-9_-]+\/SKILL\.md$/.test(path);
}

async function read(path: string): Promise<string | null> {
  await validatePath(path);
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Invalid or oversized knowledge file');
    return await readFile(path, 'utf8');
  } catch (error: unknown) {
    if (missing(error)) return null;
    throw error;
  }
}

async function snapshot(root: string, kind: 'memory' | 'skills'): Promise<KnowledgeSnapshot> {
  await validatePath(root);
  const files = new Map<string, string>();
  let paths = ['USER.md', 'MEMORY.md'];
  if (kind === 'skills') {
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); }
    catch (error: unknown) { if (missing(error)) return files; throw error; }
    if (entries.length > 1000) throw new Error('Too many skills for a bounded review');
    if (entries.some(entry => entry.isSymbolicLink())) throw new Error('Symlinked skills are not eligible');
    paths = entries.filter(entry => entry.isDirectory()).map(entry => `${entry.name}/SKILL.md`);
  }
  let bytes = 0;
  for (const path of paths) {
    if (!validName(kind, path)) throw new Error('Unsupported knowledge filename');
    const content = await read(join(root, path));
    if (content !== null) {
      bytes += Buffer.byteLength(content);
      if (bytes > 8 * MAX_BYTES) throw new Error('Knowledge snapshot exceeds review budget');
      files.set(path, content);
    }
  }
  return files;
}

/** All managed writers share the published core lock. External editors remain
 * outside that cooperative lock; revision comparison still detects prior edits. */
export function createLearningKnowledgeFiles(options: {
  memoryDirectory: string;
  skillsDirectory: string;
  authorize(): Promise<void>;
}): KnowledgeFilePort & Pick<KnowledgeStagingPort, 'snapshot' | 'create'> {
  const roots = { memory: resolve(options.memoryDirectory), skills: resolve(options.skillsDirectory) };
  function target(relativePath: string) {
    const slash = relativePath.indexOf('/');
    const kind = relativePath.slice(0, slash);
    const name = relativePath.slice(slash + 1);
    if ((kind !== 'memory' && kind !== 'skills') || !validName(kind, name)) throw new Error('Invalid knowledge destination');
    return { root: roots[kind], path: join(roots[kind], name) };
  }
  return {
    async read(relativePath) {
      await options.authorize();
      return read(target(relativePath).path);
    },
    async compareAndSwap(relativePath, expected, replacement) {
      const destination = target(relativePath);
      return withKnowledgeMutationLock(destination.root, async () => {
        await options.authorize();
        if (await read(destination.path) !== expected) return false;
        if (replacement !== null && Buffer.byteLength(replacement) > MAX_BYTES) throw new Error('Knowledge file exceeds review budget');
        await validatePath(destination.path);
        if (replacement === null) {
          await options.authorize();
          if (await read(destination.path) !== expected) return false;
          // Only remove SKILL.md, never bundled references or scripts.
          await rm(destination.path, { force: true });
          return true;
        }
        await mkdir(dirname(destination.path), { recursive: true });
        await validatePath(destination.path);
        const temp = `${destination.path}.${crypto.randomUUID()}.tmp`;
        try {
          const handle = await open(temp, 'wx', 0o600);
          try { await handle.writeFile(replacement, 'utf8'); await handle.sync(); }
          finally { await handle.close(); }
          await options.authorize();
          if (await read(destination.path) !== expected) return false;
          await rename(temp, destination.path);
          return true;
        } finally { await rm(temp, { force: true }); }
      });
    },
    async snapshot(kind) {
      return withKnowledgeMutationLock(roots[kind], async () => {
        await options.authorize();
        return snapshot(roots[kind], kind);
      });
    },
    async create(kind, initial) {
      await options.authorize();
      // Canonicalize the OS temp directory (macOS commonly aliases /var).
      const base = await realpath(tmpdir());
      const directory = await mkdtemp(join(base, 'prokop-learning-'));
      try {
        for (const [path, content] of initial) {
          if (!validName(kind, path)) throw new Error('Invalid staging path');
          const absolute = join(directory, path);
          if (!absolute.startsWith(directory + sep)) throw new Error('Staging path escapes root');
          await mkdir(dirname(absolute), { recursive: true });
          const handle = await open(absolute, 'wx', 0o600);
          try { await handle.writeFile(content, 'utf8'); } finally { await handle.close(); }
        }
      } catch (error: unknown) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
      return {
        directory,
        snapshot: () => snapshot(directory, kind),
        dispose: () => rm(directory, { recursive: true, force: true }),
      };
    },
  };
}
