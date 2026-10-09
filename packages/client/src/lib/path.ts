export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || '';
}

export function join(...parts: string[]): string {
  return parts
    .map((part, i) => {
      if (i === 0) return part.replace(/\/+$/, '');
      return part.replace(/^\/+|\/+$/g, '');
    })
    .filter(Boolean)
    .join('/');
}

export interface WorkspaceFileTarget {
  path: string;
  /** Additional root the path lives in; absent for the main workspace root. */
  root?: string;
}

/**
 * Tool paths can be absolute (Claude Code and Codex report them that way),
 * while the file tree, preview and editor address files as a root plus a
 * path relative to it. Splitting here makes "open in editor" work and gives
 * the same editor tab as opening the file from the tree. Relative paths and
 * paths outside every root come back unchanged.
 */
export function toWorkspaceFileTarget(
  path: string,
  workspace: { path: string; additionalPaths?: string[] },
): WorkspaceFileTarget {
  const normalized = path.replace(/\\/g, '/');
  if (!normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized)) return { path };

  const roots = [workspace.path, ...(workspace.additionalPaths ?? [])]
    .map(root => ({ root, prefix: root.replace(/\\/g, '/').replace(/\/+$/, '') }))
    .filter(({ prefix }) => prefix.length > 0)
    // The most specific root wins when one root is nested in another.
    .sort((a, b) => b.prefix.length - a.prefix.length);

  for (const { root, prefix } of roots) {
    if (normalized !== prefix && !normalized.startsWith(`${prefix}/`)) continue;
    const relative = normalized.slice(prefix.length + 1);
    return root === workspace.path ? { path: relative } : { path: relative, root };
  }
  return { path };
}
