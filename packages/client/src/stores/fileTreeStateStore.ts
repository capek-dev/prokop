import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Persists which directories the Project tree has expanded, per
 * `${workspaceId}:${root}` key. The Pierre model rebuilds its expansion map
 * on every `resetPaths`, so this store is the source of truth: the adapter
 * passes it as `initialExpandedPaths` and records snapshots after each
 * change, keeping your place across refreshes, tool runs, and reloads.
 */
interface FileTreeStateState {
  byKey: Record<string, string[]>;
  recordExpanded: (key: string, directoryPaths: string[]) => void;
}

export const useFileTreeStateStore = create<FileTreeStateState>()(
  persist(
    (set) => ({
      byKey: {},
      recordExpanded: (key, directoryPaths) =>
        set((state) => ({
          byKey: state.byKey[key] === directoryPaths
            ? state.byKey
            : { ...state.byKey, [key]: directoryPaths },
        })),
    }),
    { name: 'prokopai-file-tree-state' },
  ),
);

/** Current expanded-directory list for a tree identity (read outside React). */
export function fileTreeExpandedPaths(key: string): string[] {
  return useFileTreeStateStore.getState().byKey[key] ?? [];
}
