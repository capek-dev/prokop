/**
 * Pure path and name helpers for filesystem context actions. No React or SDK
 * imports so the validation and doc-matching logic is unit-testable in
 * isolation.
 */

/** Structural subset of FileDocIdentity for scope matching. */
export interface DocIdentityLike {
  serverId: string;
  workspaceId: string;
  root?: string;
  path: string;
}

/** Delete-scope matcher input; scope fields are optional filters. */
export interface DeleteTargetMatch {
  serverId?: string;
  workspaceId?: string;
  root?: string;
  path: string;
  isDirectory: boolean;
}

/** Remove every trailing slash ('' stays ''). */
export function stripTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '');
}

/** Join a root-relative parent dir ('' = workspace root) with an entry name. */
export function joinRootRelative(parentDirPath: string, name: string): string {
  const parent = stripTrailingSlash(parentDirPath);
  const cleanName = name.replace(/^\/+/, '');
  return parent === '' ? cleanName : `${parent}/${cleanName}`;
}

/**
 * Whether `path` equals `prefix` or lives under `prefix/`. An empty prefix
 * matches everything (it is the workspace root).
 */
export function isUnderPath(prefix: string, path: string): boolean {
  const clean = stripTrailingSlash(prefix);
  if (clean === '') return true;
  return path === clean || path.startsWith(`${clean}/`);
}

/**
 * Validate a user-supplied entry name or relative path (slashes allowed for
 * nested creation). Returns an error message, or null when valid.
 */
export function validateEntryName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Name is required';
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) {
    return 'Name must not start or end with a slash';
  }
  const segments = trimmed.split('/');
  if (segments.some((segment) => segment === '')) {
    return 'Name must not contain empty path segments';
  }
  if (segments.some((segment) => segment === '..')) {
    return 'Name must not contain ".." segments';
  }
  return null;
}

/** Rename validation: entry rules plus the target must differ from the source. */
export function validateRenameTarget(to: string, from: string): string | null {
  if (to === from) return 'New path must differ from the current path';
  return validateEntryName(to);
}

/**
 * Whether an open editor doc must close when `target` is deleted: exact path
 * match for files, path + '/' prefix for directories, scoped to the same
 * server/workspace/root. Omitted scope fields on the target are not filtered.
 */
export function docMatchesDeleteTarget(
  identity: DocIdentityLike,
  target: DeleteTargetMatch,
): boolean {
  if (target.serverId !== undefined && identity.serverId !== target.serverId) return false;
  if (target.workspaceId !== undefined && identity.workspaceId !== target.workspaceId) return false;
  if ((target.root ?? '') !== (identity.root ?? '')) return false;
  const targetPath = stripTrailingSlash(target.path);
  const identityPath = stripTrailingSlash(identity.path);
  if (target.isDirectory) {
    return identityPath === targetPath || identityPath.startsWith(`${targetPath}/`);
  }
  return identityPath === targetPath;
}

/**
 * Join the workspace absolute path with a root-relative path for clipboard
 * copy. A missing workspace path yields the relative path unchanged.
 */
export function joinCopyAbsolutePath(workspacePath: string | undefined, rel: string): string {
  if (!workspacePath) return stripTrailingSlash(rel);
  const base = stripTrailingSlash(workspacePath);
  const cleanRel = rel.replace(/^\/+/, '');
  return base === '' ? cleanRel : `${base}/${cleanRel}`;
}
