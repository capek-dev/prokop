import { resolve, isAbsolute, join, relative, sep } from 'path';
import { homedir } from 'os';

export function expandPath(inputPath: string): string {
  let expanded = inputPath;
  if (expanded.startsWith('~/') || expanded === '~') {
    expanded = join(homedir(), expanded.slice(1));
  }
  return resolve(expanded);
}

export function resolvePath(path: string, workspacePath: string): string {
  if (path.startsWith('~/') || path === '~') {
    return join(homedir(), path.slice(1));
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

/**
 * Resolves an optional `root` query param to an allowed absolute root path.
 * When `root` is provided it must exactly match either the workspace.path or
 * one of additionalPaths. Falls back to workspace.path when missing/invalid.
 * Returns the selected root and a boolean indicating whether it is the main
 * workspace path.
 */
export function resolveRoot(
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
