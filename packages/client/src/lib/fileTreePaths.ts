import type { FileTreeResponse, FileTreeUpdate } from '@prokopai/sdk';

type FileTreeDelta = Extract<FileTreeUpdate, { kind: 'delta' }>;

/** Same order as the server walk (`listTreePaths`). */
const comparePaths = (a: string, b: string): number => a.localeCompare(b);

/** Keeps the newer of two trees; pushes and HTTP reads can arrive in either order. */
export function newerFileTree(current: FileTreeResponse | undefined, next: FileTreeResponse): FileTreeResponse {
  if (!current || current.root !== next.root) return next;
  return (current.revision ?? 0) > (next.revision ?? 0) ? current : next;
}

/** The tree after a pushed delta. The caller checks `baseRevision` first. */
export function applyFileTreeDelta(tree: FileTreeResponse, delta: FileTreeDelta): FileTreeResponse {
  const removed = new Set(delta.removed);
  const kept = removed.size ? tree.paths.filter((path) => !removed.has(path)) : tree.paths;
  const paths = delta.added.length ? kept.concat(delta.added).sort(comparePaths) : kept;
  return { ...tree, paths, truncated: delta.truncated, revision: delta.revision };
}
