import type { FileTreeBatchOperation } from '@pierre/trees';

/** Above this, one `resetPaths` is cheaper than a batch of single mutations. */
const MAX_BATCH_OPERATIONS = 2_000;

/**
 * Operations that move the Pierre model from `previous` to `next`
 * (find-style paths, directories end in `/`), or null when a full reset is
 * cheaper. `exists` reads the model as it is now, which may already hold
 * optimistic create, rename, and delete updates, so those are skipped
 * instead of failing the batch (Pierre batches are not atomic).
 */
export function fileTreeSyncOperations(
  previous: readonly string[],
  next: readonly string[],
  exists: (path: string) => boolean,
): FileTreeBatchOperation[] | null {
  const before = new Set(previous);
  const after = new Set(next);
  const added = next.filter((path) => !before.has(path));
  const removed = previous.filter((path) => !after.has(path));
  if (added.length + removed.length > MAX_BATCH_OPERATIONS) return null;

  const operations: FileTreeBatchOperation[] = [];
  // Code-unit order puts a directory right before its descendants. Removing
  // a directory removes them too, so only the topmost removal is sent.
  let removedDirectory: string | null = null;
  for (const path of removed.sort()) {
    if (removedDirectory && path.startsWith(removedDirectory)) continue;
    const isDirectory = path.endsWith('/');
    if (isDirectory) removedDirectory = path;
    if (!exists(path)) continue;
    operations.push(isDirectory ? { type: 'remove', path, recursive: true } : { type: 'remove', path });
  }
  // Adding a path creates its parents; a directory is added on its own only when empty.
  added.sort();
  added.forEach((path, index) => {
    if (path.endsWith('/') && added[index + 1]?.startsWith(path)) return;
    if (!exists(path)) operations.push({ type: 'add', path });
  });
  return operations;
}
