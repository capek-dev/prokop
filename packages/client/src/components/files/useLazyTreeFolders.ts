import { useCallback, useEffect, useRef } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';

/** The slice of the Pierre tree model the loader needs. */
export interface LazyTreeModel {
  getItem(path: string): unknown;
  getVisibleCount(): number;
  getVisibleRows(start: number, end: number): ReadonlyArray<{ kind: string; isExpanded?: boolean; path: string }>;
  batch(operations: ReadonlyArray<{ type: 'add'; path: string } | { type: 'remove'; path: string; recursive?: boolean }>): void;
  subscribe(listener: () => void): () => void;
}

interface LazyTreeFoldersOptions {
  model: LazyTreeModel;
  sdkClient: ProkopaiClient | null;
  workspaceId: string;
  root?: string;
  /** Ignored paths from the tree walk; directories (trailing `/`) were not walked. */
  ignored: readonly string[];
}

/** Folders at or below an unwalked folder load their contents on expand. */
export function isLazyFolder(path: string, unwalked: readonly string[]): boolean {
  return path.endsWith('/') && unwalked.some((folder) => path.startsWith(folder));
}

/** Direct children of `folder` among the visible rows (an expanded folder shows them all). */
function visibleChildren(model: LazyTreeModel, folder: string): string[] {
  const count = model.getVisibleCount();
  if (count === 0) return [];
  return model.getVisibleRows(0, count)
    .map((row) => row.path)
    .filter((path) => path.startsWith(folder) && path !== folder && !path.slice(folder.length, -1).includes('/'));
}

/**
 * Loads the folders the server lists without walking (node_modules, ignored
 * build output) one level at a time, when they are expanded, so nothing
 * below an open level is ever fetched. Call `reset` after the tree is
 * rebuilt with `resetPaths`, which drops the children added here, and after
 * a refresh, which does not re-walk these folders: open ones load again and
 * their children are reconciled with the server.
 */
export function useLazyTreeFolders({ model, sdkClient, workspaceId, root, ignored }: LazyTreeFoldersOptions): { reset: () => void } {
  const loaded = useRef(new Set<string>());
  const loading = useRef(new Set<string>());
  const unwalked = useRef<string[]>([]);
  const live = useRef({ sdkClient, workspaceId, root });
  const frame = useRef<number | null>(null);

  useEffect(() => {
    live.current = { sdkClient, workspaceId, root };
  });

  const load = useCallback(async (folder: string) => {
    const { sdkClient: client, workspaceId: liveWorkspaceId, root: liveRoot } = live.current;
    if (!client) return;
    loading.current.add(folder);
    try {
      const { paths } = await client.http.files.treeChildren(liveWorkspaceId, folder.slice(0, -1), { root: liveRoot });
      // A parent reload may have removed this folder meanwhile; adding its children would recreate it.
      if (model.getItem(folder) == null) return;
      const listed = new Set(paths);
      // A reload after a refresh also drops children deleted since the last load.
      const removed = visibleChildren(model, folder).filter((path) => !listed.has(path));
      const added = paths.filter((path) => model.getItem(path) == null);
      if (removed.length || added.length) {
        model.batch([
          ...removed.map((path) => (path.endsWith('/') ? { type: 'remove' as const, path, recursive: true } : { type: 'remove' as const, path })),
          ...added.map((path) => ({ type: 'add' as const, path })),
        ]);
      }
      loaded.current.add(folder);
    } catch {
      // Not marked loaded: collapsing and expanding the folder tries again.
    } finally {
      loading.current.delete(folder);
    }
  }, [model]);

  const check = useCallback(() => {
    if (unwalked.current.length === 0) return;
    const count = model.getVisibleCount();
    if (count === 0) return;
    for (const row of model.getVisibleRows(0, count)) {
      if (row.kind !== 'directory' || !row.isExpanded) continue;
      if (loaded.current.has(row.path) || loading.current.has(row.path)) continue;
      if (isLazyFolder(row.path, unwalked.current)) void load(row.path);
    }
  }, [model, load]);

  // Expansion is model state without its own event; checks coalesce per frame.
  useEffect(() => {
    const unsubscribe = model.subscribe(() => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        check();
      });
    });
    return () => {
      unsubscribe();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [model, check]);

  useEffect(() => {
    unwalked.current = ignored.filter((path) => path.endsWith('/'));
    check();
  }, [ignored, check]);

  const reset = useCallback(() => {
    loaded.current.clear();
    check();
  }, [check]);

  return { reset };
}
