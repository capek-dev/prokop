/**
 * Server-owned file tree feed. One serialized walk per watched workspace
 * root, shared by every subscriber and by HTTP reads. Subscribers get the
 * whole tree once, then only the paths added and removed, and nothing when
 * a tool call left the path set unchanged (edits, read-only shell calls).
 * Scheduling lives in the shared root feed (`./root-feed`).
 */

import type { FileTreeMessage, FileTreeResponse } from '@prokopai/sdk';
import { createRootFeed, type RootFeed, type RootFeedDependencies } from './root-feed';

export type FileTreeSnapshot = Omit<FileTreeResponse, 'revision'>;

export type FileTreeFeedDependencies<Subscriber> =
  Omit<RootFeedDependencies<Subscriber, FileTreeSnapshot, FileTreeMessage>, 'same' | 'message'>;

export type FileTreeFeed<Subscriber> = RootFeed<Subscriber, FileTreeSnapshot>;

function samePaths(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Paths only in `next` (added) and only in `previous` (removed), each in input order. */
export function diffTreePaths(
  previous: readonly string[],
  next: readonly string[],
): { added: string[]; removed: string[] } {
  const before = new Set(previous);
  const after = new Set(next);
  return {
    added: next.filter((path) => !before.has(path)),
    removed: previous.filter((path) => !after.has(path)),
  };
}

export function createFileTreeFeed<Subscriber>(
  deps: FileTreeFeedDependencies<Subscriber>,
): FileTreeFeed<Subscriber> {
  return createRootFeed<Subscriber, FileTreeSnapshot, FileTreeMessage>({
    ...deps,
    same: (previous, next) => previous.isMain === next.isMain
      && previous.truncated === next.truncated
      && samePaths(previous.paths, next.paths),
    message: ({ workspaceId, root, current, previous }) => {
      if (previous) {
        const { added, removed } = diffTreePaths(previous.paths, current.paths);
        // A branch switch can touch most of the tree; then the snapshot is smaller.
        if (added.length + removed.length < current.paths.length) {
          return {
            type: 'files.tree',
            workspaceId,
            root,
            update: {
              kind: 'delta',
              baseRevision: previous.revision,
              revision: current.revision,
              added,
              removed,
              truncated: current.truncated,
            },
          };
        }
      }
      return { type: 'files.tree', workspaceId, root, update: { kind: 'snapshot', tree: current } };
    },
  });
}
