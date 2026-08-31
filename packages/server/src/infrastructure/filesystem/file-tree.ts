/**
 * Filesystem infrastructure implementation (S5 filesystem isolation).
 * Full-tree path listing plus create/rename/delete mutations over the C6
 * workspace path policy. Paths are workspace-root-relative with POSIX
 * separators. Every mutation re-validates against the canonical (realpath)
 * root so symlinks cannot escape the workspace.
 */

import { promises as fsp } from 'fs';
import { dirname, extname, join, relative, resolve, sep } from 'path';
import type {
  CreateFileResponse,
  DeleteFileResponse,
  RenameFileResponse,
} from '@prokopai/sdk';
import { IGNORE_PATTERNS } from './workspace-files';
import { isBinaryExtension } from './binary-detection';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@/application/http-errors';

/** Hard cap so a runaway workspace cannot exhaust memory in one response. */
const FILE_TREE_MAX_ENTRIES = 50_000;

/** Refuses pathological segment names that are valid on disk but harmful in trees. */
export function validateSegmentName(name: string): void {
  if (!name || name === '.' || name === '..') {
    throw new BadRequestError('Invalid file name');
  }
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new BadRequestError('Invalid file name');
  }
}

/**
 * Normalizes and lexically validates a root-relative input path:
 * forward slashes only, no `..` segments, no leading/trailing separators.
 */
export function normalizeRelativePath(inputPath: string): string {
  const normalized = inputPath.split('\\').join('/');
  if (normalized.startsWith('/')) {
    throw new BadRequestError('Path must be relative to the workspace root');
  }
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === '..') {
      throw new ForbiddenError('Path outside workspace');
    }
    validateSegmentName(segment);
  }
  return segments.join('/');
}

/** The injected C6 workspace path policy surface used by tree operations. */
export interface TreeWorkspacePolicy {
  selectEditableRoot(
    workspace: WorkspaceLike,
    rootQuery?: string,
  ): { root: string; valid: boolean };
  isPathInside(child: string, parent: string): boolean;
  isInsideUnselectedAdditionalRoot(
    candidate: string,
    selectedRoot: string,
    additionalPaths: string[],
  ): boolean;
}

export interface WorkspaceLike {
  path: string;
  additionalPaths: string[];
}

/** Names hidden at every depth, matching listDirectory's name filter. */
const IGNORED_ENTRY_NAMES = new Set(IGNORE_PATTERNS.map((pattern) => pattern.split('/')[0]));

/** Walks the workspace root collecting root-relative POSIX paths. */
async function walkDirectory(
  dirAbs: string,
  prefix: string,
  showHidden: boolean,
  out: string[],
  truncatedFlag: { value: boolean },
): Promise<void> {
  let entries;
  try {
    entries = await fsp.readdir(dirAbs, { withFileTypes: true });
  } catch {
    // Unreadable directories simply contribute nothing, like listDirectory.
    return;
  }

  for (const entry of entries) {
    if (out.length >= FILE_TREE_MAX_ENTRIES) {
      truncatedFlag.value = true;
      return;
    }
    if (entry.name === '.git') continue;
    if (!showHidden && entry.name.startsWith('.')) continue;
    // Name-based hiding mirrors listDirectory: node_modules, dist, build,
    // .next, .DS_Store, Thumbs.db are dropped regardless of showHidden.
    if (IGNORED_ENTRY_NAMES.has(entry.name)) continue;
    const relPath = `${prefix}${prefix.length > 0 ? '/' : ''}${entry.name}`;

    // Directory entries carry a trailing slash (find-style) so consumers can
    // distinguish directories from extension-less files; path-store builders
    // treat a bare parent name followed by descendants as a file/dir
    // collision otherwise.
    const isDir = entry.isDirectory();
    out.push(isDir ? `${relPath}/` : relPath);
    if (!isDir) continue;

    await walkDirectory(join(dirAbs, entry.name), relPath, showHidden, out, truncatedFlag);
  }
}

function toPosixRootRelative(absPath: string, root: string): string {
  return relative(root, absPath).split(sep).join('/');
}

async function existsPath(target: string): Promise<boolean> {
  try {
    await fsp.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function statOrNull(target: string) {
  try {
    return await fsp.lstat(target);
  } catch {
    return null;
  }
}

function wrapFsError(err: unknown, fallback: string): Error {
  if (err instanceof Error && typeof (err as NodeJS.ErrnoException).code === 'string') {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`${fallback}: ${message}`);
}

/**
 * Walks up from an absolute path until it finds an existing ancestor, then
 * requires that ancestor to resolve inside the canonical root. This catches
 * symlink tricks where the final segment does not exist yet.
 */
async function ensureDeepestExistingAncestorInside(
  policy: TreeWorkspacePolicy,
  startAbs: string,
  canonicalRoot: string,
): Promise<void> {
  let probe = startAbs;
  while (true) {
    try {
      const real = await fsp.realpath(probe);
      if (!policy.isPathInside(real, canonicalRoot)) {
        throw new ForbiddenError('Path outside workspace');
      }
      return;
    } catch (err: unknown) {
      if (err instanceof ForbiddenError) throw err;
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      const parent = dirname(probe);
      if (parent === probe) {
        throw new NotFoundError('Workspace root not found');
      }
      probe = parent;
    }
  }
}

export function createFileTreeOps(policy: TreeWorkspacePolicy) {
  async function canonicalizeRoot(root: string): Promise<string> {
    try {
      return await fsp.realpath(root);
    } catch {
      throw new NotFoundError('Workspace root not found');
    }
  }

  /** Resolves the selected root and canonicalizes it once per operation. */
  async function prepareRoot(
    workspace: WorkspaceLike,
    rootQuery?: string,
  ): Promise<{ root: string; canonicalRoot: string }> {
    const selection = policy.selectEditableRoot(workspace, rootQuery);
    if (!selection.valid) {
      throw new BadRequestError('Invalid workspace root');
    }
    return { root: selection.root, canonicalRoot: await canonicalizeRoot(selection.root) };
  }

  /**
   * Resolves one normalized root-relative path into an absolute candidate
   * with strict lexical containment (no `..`, no unselected roots).
   */
  async function resolveMutationTarget(
    workspace: WorkspaceLike,
    root: string,
    inputPath: string,
  ): Promise<string> {
    const relativePath = normalizeRelativePath(inputPath);
    if (relativePath.length === 0) {
      throw new BadRequestError('Path is required');
    }
    const candidate = resolve(root, ...relativePath.split('/'));
    if (
      !policy.isPathInside(candidate, resolve(root))
      || policy.isInsideUnselectedAdditionalRoot(candidate, resolve(root), workspace.additionalPaths)
    ) {
      throw new ForbiddenError('Path outside workspace');
    }
    return candidate;
  }

  async function listTreePaths(
    workspace: WorkspaceLike,
    input: { root?: string; showHidden?: boolean },
  ): Promise<{ root: string; isMain: boolean; paths: string[]; truncated: boolean }> {
    const selection = policy.selectEditableRoot(workspace, input.root);
    if (!selection.valid) {
      throw new BadRequestError('Invalid workspace root');
    }
    const root = selection.root;
    const rootAbs = resolve(root);
    const paths: string[] = [];
    const truncatedFlag = { value: false };
    await walkDirectory(
      rootAbs,
      '',
      input.showHidden ?? true,
      paths,
      truncatedFlag,
    );
    paths.sort((a, b) => a.localeCompare(b));
    return { root, isMain: rootAbs === resolve(workspace.path), paths, truncated: truncatedFlag.value };
  }

  async function createFileOrDirectory(
    workspace: WorkspaceLike,
    input: { path: string; kind?: 'file' | 'directory'; root?: string; createParents?: boolean },
  ): Promise<CreateFileResponse> {
    const { root, canonicalRoot } = await prepareRoot(workspace, input.root);
    const target = await resolveMutationTarget(workspace, root, input.path);

    if (await existsPath(target)) {
      throw new ConflictError(`Entry already exists: ${input.path}`);
    }

    const kind = input.kind ?? 'file';
    const parentDir = dirname(target);
    if (input.createParents !== false && !(await existsPath(parentDir))) {
      await ensureDeepestExistingAncestorInside(policy, parentDir, canonicalRoot);
      await fsp.mkdir(parentDir, { recursive: true });
    } else if (!(await existsPath(parentDir))) {
      throw new NotFoundError('Parent directory not found');
    }

    if (kind === 'directory') {
      try {
        await fsp.mkdir(target);
      } catch (err: unknown) {
        throw wrapFsError(err, 'Create failed');
      }
      return { path: toPosixRootRelative(target, root) };
    }

    // Exclusive open fails if another process races us instead of truncating.
    const extension = extname(target);
    if (isBinaryExtension(extension)) {
      throw new BadRequestError('Cannot create a binary extension without content support');
    }
    let handle;
    try {
      handle = await fsp.open(target, 'wx');
    } catch (err: unknown) {
      throw wrapFsError(err, 'Create failed');
    }
    try {
      await handle.close();
    } catch {
      // Nothing else to do for an empty new file.
    }
    return { path: toPosixRootRelative(target, root) };
  }

  async function renameFileEntry(
    workspace: WorkspaceLike,
    input: { from: string; to: string; root?: string; overwrite?: boolean },
  ): Promise<RenameFileResponse> {
    const { root, canonicalRoot } = await prepareRoot(workspace, input.root);
    const sourceAbs = await resolveMutationTarget(workspace, root, input.from);
    const destAbs = await resolveMutationTarget(workspace, root, input.to);

    if (sourceAbs === destAbs) {
      throw new BadRequestError('Rename source and destination are identical');
    }

    const sourceStats = await statOrNull(sourceAbs);
    if (!sourceStats) {
      throw new NotFoundError('File not found');
    }

    // A directory may never move into its own subtree.
    if (
      sourceStats.isDirectory()
      && (destAbs === resolve(canonicalRoot) || policy.isPathInside(destAbs, sourceAbs))
    ) {
      throw new BadRequestError('Cannot move a directory into itself');
    }

    const destStats = await statOrNull(destAbs);
    if (destStats) {
      // Overwrite applies to files only; directories are never replaced.
      if (destStats.isDirectory() || !input.overwrite) {
        throw new ConflictError(`Destination already exists: ${input.to}`);
      }
    }

    // Both parents must resolve inside the canonical root before the rename.
    await ensureDeepestExistingAncestorInside(policy, dirname(sourceAbs), canonicalRoot);
    await ensureDeepestExistingAncestorInside(policy, dirname(destAbs), canonicalRoot);

    try {
      await fsp.rename(sourceAbs, destAbs);
    } catch (err: unknown) {
      throw wrapFsError(err, 'Rename failed');
    }

    return {
      path: toPosixRootRelative(destAbs, root),
      from: toPosixRootRelative(sourceAbs, root),
    };
  }

  async function deleteFileEntry(
    workspace: WorkspaceLike,
    input: { path: string; root?: string; recursive?: boolean },
  ): Promise<DeleteFileResponse> {
    const { root, canonicalRoot } = await prepareRoot(workspace, input.root);
    const target = await resolveMutationTarget(workspace, root, input.path);
    if (resolve(target) === resolve(canonicalRoot)) {
      throw new BadRequestError('Refusing to delete the workspace root');
    }

    const stats = await statOrNull(target);
    if (!stats) {
      throw new NotFoundError('File not found');
    }

    try {
      if (stats.isDirectory()) {
        if (input.recursive) {
          await fsp.rm(target, { recursive: true });
        } else {
          await fsp.rmdir(target);
        }
      } else {
        // lstat above means a symlink entry itself is removed, never its target.
        await fsp.unlink(target);
      }
    } catch (err: unknown) {
      if (
        !input.recursive
        && (err as NodeJS.ErrnoException)?.code === 'ENOTEMPTY'
      ) {
        throw new ConflictError('Directory not empty (pass recursive to delete)');
      }
      throw wrapFsError(err, 'Delete failed');
    }

    return { path: toPosixRootRelative(target, root), recursive: Boolean(input.recursive) };
  }

  return { listTreePaths, createFileOrDirectory, renameFileEntry, deleteFileEntry };
}
