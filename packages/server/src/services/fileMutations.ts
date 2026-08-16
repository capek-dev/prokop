import { createHash, randomUUID } from 'crypto';
import { stat, readFile, realpath, writeFile, rename, unlink, chmod } from 'fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path';
import type {
  EditableFileResponse,
  FileRevisionConflictDetails,
  SaveFileResponse,
} from '@jean2/sdk';
import {
  FILE_PREVIEW_MAX_BYTES,
  isBinaryBuffer,
  isBinaryExtension,
} from '@/utils/binaryDetection';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
} from '@/utils/http-errors';
import {
  isInsideUnselectedAdditionalRoot,
  isPathInside,
  resolveCandidatePath,
  selectEditableRoot,
} from '@/domains/workspaces';

import { getLanguageForPath, getMimeTypeForPath } from '@/services/filePreview';

interface WorkspaceLike {
  path: string;
  additionalPaths: string[];
}

function resolveSelectedRoot(workspace: WorkspaceLike, rootQuery?: string): string {
  const selection = selectEditableRoot(workspace, rootQuery);
  if (!selection.valid) {
    throw new BadRequestError('Invalid workspace root');
  }
  return selection.root;
}

/** SHA-256 hex digest of exact file bytes. */
function hashBytes(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Resolve the client-supplied path against the selected root into an absolute
 * candidate path. Absolute inputs are resolved verbatim; relative inputs are
 * anchored to the selected root (consistent with the preview route).
 */
function resolveCandidate(root: string, inputPath: string): string {
  return resolveCandidatePath(root, inputPath);
}

/** Canonicalize the selected root via realpath so symlinked roots resolve correctly. */
async function canonicalizeRoot(root: string): Promise<string> {
  try {
    return await realpath(root);
  } catch {
    throw new NotFoundError('Workspace root not found');
  }
}

/** Render an absolute path relative to the selected root using forward slashes. */
function toRootRelative(absPath: string, root: string): string {
  const rel = relative(root, absPath);
  return rel.split(sep).join('/');
}

/**
 * Read a UTF-8 text file for editing, returning its content plus a SHA-256
 * revision the client must echo back to save conflict-free.
 *
 * The operation is constrained to the selected root: a lexical containment
 * check against the selected root rejects traversal/absolute paths into other
 * roots, and a realpath check against the canonicalized selected root rejects
 * symlinks that escape it. Rejects directories, missing files, binary files,
 * and files exceeding the preview byte limit.
 */
export async function readEditableFile(
  workspace: WorkspaceLike,
  inputPath: string,
  rootQuery?: string,
): Promise<EditableFileResponse> {
  const root = resolveSelectedRoot(workspace, rootQuery);
  const lexicalRoot = resolve(root);
  const candidate = resolveCandidate(root, inputPath);

  if (
    !isPathInside(candidate, lexicalRoot)
    || (
      isAbsolute(inputPath)
      && isInsideUnselectedAdditionalRoot(candidate, lexicalRoot, workspace.additionalPaths)
    )
  ) {
    throw new ForbiddenError('Path outside workspace');
  }

  const canonicalRoot = await canonicalizeRoot(root);

  let realPath: string;
  try {
    realPath = await realpath(candidate);
  } catch {
    throw new NotFoundError('File not found');
  }
  if (!isPathInside(realPath, canonicalRoot)) {
    throw new ForbiddenError('Path outside workspace');
  }

  let stats;
  try {
    stats = await stat(realPath);
  } catch {
    throw new NotFoundError('File not found');
  }

  if (stats.isDirectory()) {
    throw new BadRequestError('Cannot edit a directory');
  }

  const size = stats.size;
  if (size > FILE_PREVIEW_MAX_BYTES) {
    throw new PayloadTooLargeError('File is too large to edit');
  }

  const extension = extname(realPath);
  if (isBinaryExtension(extension)) {
    throw new BadRequestError('Cannot edit a binary file');
  }

  let buf: Buffer;
  try {
    buf = await readFile(realPath);
  } catch {
    throw new NotFoundError('File not found');
  }

  if (buf.length > FILE_PREVIEW_MAX_BYTES) {
    throw new PayloadTooLargeError('File is too large to edit');
  }
  if (isBinaryBuffer(buf)) {
    throw new BadRequestError('Cannot edit a binary file');
  }

  const content = buf.toString('utf-8');
  const revision = hashBytes(buf);
  const name = basename(realPath);
  const rootRelative = toRootRelative(candidate, root);

  return {
    path: rootRelative,
    name,
    extension: extension || undefined,
    size: buf.length,
    content,
    revision,
    readOnly: false as const,
    mimeType: getMimeTypeForPath(realPath),
    language: getLanguageForPath(realPath),
    encoding: 'utf-8' as const,
  };
}

export interface SaveFileInput {
  path: string;
  content: string;
  expectedRevision: string;
  root?: string;
  force?: boolean;
}

/**
 * Save UTF-8 content to an existing file with optimistic-concurrency conflict
 * detection.
 *
 * The target file must already exist; saving cannot create new files. The
 * current file's SHA-256 revision is compared against `expectedRevision`.
 * When they differ a ConflictError is thrown carrying the current content so
 * the client can reconcile. The revision comparison is always enforced: even
 * when `force` is true the supplied `expectedRevision` must match the current
 * revision (the UI resends the conflict's `actualRevision` for an explicit
 * overwrite retry). If the file changed again, a new conflict is returned.
 *
 * The operation is constrained to the selected root via lexical containment
 * and a realpath check against the canonicalized selected root. The write is
 * atomic: content is written to a temp file in the same directory and renamed
 * over the canonical real target (so symlink files are followed and the linked
 * file is replaced rather than the symlink entry itself). The existing file
 * mode is preserved. The temp file is cleaned up on failure, and unexpected
 * errors (including mode-preservation failure) are logged with context before
 * being rethrown.
 */
export async function saveFile(
  workspace: WorkspaceLike,
  input: SaveFileInput,
): Promise<SaveFileResponse> {
  const root = resolveSelectedRoot(workspace, input.root);
  const lexicalRoot = resolve(root);
  const candidate = resolveCandidate(root, input.path);
  const rootRelative = toRootRelative(candidate, root);

  if (
    !isPathInside(candidate, lexicalRoot)
    || (
      isAbsolute(input.path)
      && isInsideUnselectedAdditionalRoot(candidate, lexicalRoot, workspace.additionalPaths)
    )
  ) {
    throw new ForbiddenError('Path outside workspace');
  }

  const canonicalRoot = await canonicalizeRoot(root);

  let stats;
  try {
    stats = await stat(candidate);
  } catch {
    throw new NotFoundError('File not found');
  }

  if (stats.isDirectory()) {
    throw new BadRequestError('Cannot save over a directory');
  }

  let realTarget: string;
  try {
    realTarget = await realpath(candidate);
  } catch {
    throw new NotFoundError('File not found');
  }
  if (!isPathInside(realTarget, canonicalRoot)) {
    throw new ForbiddenError('Path outside workspace');
  }

  const parentDir = dirname(candidate);
  let realParent: string;
  try {
    realParent = await realpath(parentDir);
  } catch {
    throw new NotFoundError('File not found');
  }
  if (!isPathInside(realParent, canonicalRoot)) {
    throw new ForbiddenError('Path outside workspace');
  }

  const extension = extname(realTarget);
  if (isBinaryExtension(extension)) {
    throw new BadRequestError('Cannot edit a binary file');
  }

  if (stats.size > FILE_PREVIEW_MAX_BYTES) {
    throw new PayloadTooLargeError('File is too large to edit');
  }
  const existingMode = stats.mode;
  const currentBuf = await readFile(realTarget);
  if (currentBuf.length > FILE_PREVIEW_MAX_BYTES) {
    throw new PayloadTooLargeError('File is too large to edit');
  }
  if (isBinaryBuffer(currentBuf)) {
    throw new BadRequestError('Cannot edit a binary file');
  }
  const actualRevision = hashBytes(currentBuf);

  // The revision comparison is always enforced, even when `force` is true.
  // The UI's explicit overwrite retry resends the conflict's `actualRevision`
  // as `expectedRevision`; the save only succeeds if that revision is still
  // current. If the file changed again, a new conflict is returned.
  if (actualRevision !== input.expectedRevision) {
    const details: FileRevisionConflictDetails = {
      path: rootRelative,
      expectedRevision: input.expectedRevision,
      actualRevision,
      currentContent: currentBuf.toString('utf-8'),
    };
    throw new ConflictError('File has been modified by another process', details);
  }

  const newBuf = Buffer.from(input.content, 'utf-8');
  if (newBuf.length > FILE_PREVIEW_MAX_BYTES) {
    throw new PayloadTooLargeError('File is too large to edit');
  }
  const tempPath = join(realParent, `.jean2-save-${randomUUID()}.tmp`);

  try {
    await writeFile(tempPath, newBuf);
    await chmod(tempPath, existingMode);
    // Rename over the canonical real target so symlink files are followed and
    // the linked file is replaced rather than the symlink entry itself.
    await rename(tempPath, realTarget);
  } catch (err: unknown) {
    try {
      await unlink(tempPath);
    } catch {
      // Best effort cleanup; the real error is rethrown below.
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('File save failed:', {
      path: candidate,
      message,
    });
    throw err;
  }

  const finalStats = await stat(realTarget);
  const finalBuf = await readFile(realTarget);
  const revision = hashBytes(finalBuf);

  return {
    path: rootRelative,
    revision,
    size: finalBuf.length,
    modifiedAt: finalStats.mtime.toISOString(),
  };
}
