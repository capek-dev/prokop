import { homedir } from 'os';
import { isAbsolute, join, relative, resolve, sep } from 'path';

/**
 * Workspace domain: file-access containment policy.
 *
 * Pure path classification rules for workspace file access, moved
 * byte-for-byte from `utils/paths.ts` and the pure helpers in
 * `services/fileMutations.ts`. This slice only assigns ownership; it must
 * not change which paths are allowed or protected. The C6 workspace
 * containment/path-classification redesign is explicitly out of scope.
 */

export function expandPath(inputPath: string, home: string = homedir()): string {
  let expanded = inputPath;
  if (expanded.startsWith('~/') || expanded === '~') {
    expanded = join(home, expanded.slice(1));
  }
  return resolve(expanded);
}

export function resolvePath(path: string, workspacePath: string, home: string = homedir()): string {
  if (path.startsWith('~/') || path === '~') {
    return join(home, path.slice(1));
  }
  if (isAbsolute(path)) {
    return resolve(path);
  }
  return resolve(workspacePath, path);
}

export function isPathWithinWorkspace(
  targetPath: string,
  workspacePath: string,
  additionalPaths: string[] = [],
): boolean {
  const resolved = resolvePath(targetPath, workspacePath);
  const allAllowed = [resolve(workspacePath), ...additionalPaths.map((p) => resolve(p))];
  return allAllowed.some((allowed) => {
    const relativePath = relative(allowed, resolved);
    return relativePath === ''
      || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
  });
}

/** Separator-aware containment check so `/foo` does not match `/foobar`. */
export function isPathInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  if (parent === sep) return true;
  return child.startsWith(parent + sep);
}

/** Whether the candidate lies inside an additional root other than the
 * selected one. */
export function isInsideUnselectedAdditionalRoot(
  candidate: string,
  selectedRoot: string,
  additionalPaths: string[],
): boolean {
  return additionalPaths.some((path) => {
    const additionalRoot = resolve(path);
    return additionalRoot !== selectedRoot && isPathInside(candidate, additionalRoot);
  });
}

/** Resolve the client-supplied path against the selected root into an
 * absolute candidate path. Absolute inputs are resolved verbatim; relative
 * inputs are anchored to the selected root (consistent with the preview
 * route). */
export function resolveCandidatePath(root: string, inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, '/');
  return isAbsolute(normalized) ? resolve(normalized) : resolve(join(root, normalized));
}

/**
 * Resolves an optional `root` query param to an allowed absolute root path.
 * When `root` is provided it must exactly match either the workspace.path or
 * one of additionalPaths. Falls back to workspace.path when missing/invalid.
 * Returns the selected root and a boolean indicating whether it is the main
 * workspace path.
 */
export function resolveRootForQuery(
  workspace: { path: string; additionalPaths: string[] },
  rootQuery?: string,
): { root: string; isMain: boolean } {
  const main = resolve(workspace.path);
  if (!rootQuery) return { root: main, isMain: true };
  const resolved = resolve(rootQuery);
  if (resolved === main) return { root: main, isMain: true };
  for (const p of workspace.additionalPaths) {
    if (resolve(p) === resolved) return { root: resolved, isMain: false };
  }
  return { root: main, isMain: true };
}

/**
 * Editable-file root selection: an explicit `root` must match the main root
 * or one additional root exactly, otherwise the caller rejects with the
 * exact 'Invalid workspace root' error.
 */
export function selectEditableRoot(
  workspace: { path: string; additionalPaths: string[] },
  rootQuery?: string,
): { root: string; valid: boolean } {
  const mainRoot = resolve(workspace.path);
  if (!rootQuery) return { root: mainRoot, valid: true };

  const requestedRoot = resolve(rootQuery);
  const allowedRoots = [mainRoot, ...workspace.additionalPaths.map((path) => resolve(path))];
  if (!allowedRoots.includes(requestedRoot)) {
    return { root: mainRoot, valid: false };
  }

  return { root: requestedRoot, valid: true };
}
