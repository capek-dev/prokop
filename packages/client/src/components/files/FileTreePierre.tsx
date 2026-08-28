import { forwardRef, useCallback, useImperativeHandle, useRef, useEffect, useMemo } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import type { ProkopaiClient, GitDiffSummary } from '@prokopai/sdk';
import type {
  GitStatusEntry,
  FileTreeSelectionChangeListener,
} from '@pierre/trees';
import { FileTree as PierreFileTreeReact, useFileTree } from '@pierre/trees/react';
import type { FileEntryActionTarget } from './FileEntryContextMenu';
import { Button } from '@/components/ui/button';
import { useFileTreeFullQuery } from '@/hooks/queries/useFileTreeFullQuery';
import { useGitStatusQuery } from '@/hooks/queries/useFileQueries';
import { fileTreeExpandedPaths, useFileTreeStateStore } from '@/stores/fileTreeStateStore';
import { activatePierreFileSelection } from './pierreTreeHost';

/**
 * Maps our shadcn palette onto @pierre/trees' shadow-DOM custom properties.
 * The tree reads `-override` suffixed variables from its host element
 * (shadow DOM isolates it from `:root`), so every token below is a plain
 * indirection to an existing app variable; no hard-coded colors. Defined at
 * module level once, host-scoped in render via `[data-pierre-file-tree]`.
 */
const TREE_THEME_CSS = `
  [data-pierre-file-tree] {
    /* Structure */
    --trees-bg-override: var(--sidebar);
    --trees-fg-override: var(--sidebar-foreground);
    --trees-fg-muted-override: var(--muted-foreground);
    /* Faint edge: mix a touch of foreground into the surface instead of the
     * solid border token (Pierre paints 1px solid around the search input and
     * focus rings with this, and the raw border color reads too heavy). */
    --trees-border-color-override: color-mix(in oklab, var(--sidebar-foreground) 14%, transparent);
    --trees-accent-override: var(--primary);

    /* Interaction states */
    --trees-selected-bg-override: var(--accent);
    --trees-selected-fg-override: var(--accent-foreground);
    --trees-theme-list-hover-bg-override: var(--accent);

    /*
     * Focus ring. Pierre draws focus as a 2px outline using
     * --trees-focus-ring-color, and selected+focused rows swap to
     * --trees-selected-focused-border-color; both default into
     * --trees-accent, which reads far heavier than our app rings.
     * Bind to the app's own subtle ring token instead.
     */
    --trees-focus-ring-color-override: var(--ring);
    --trees-selected-focused-border-color-override: var(--sidebar-ring);

    /* Search box (built-in tree search UI) */
    --trees-search-bg-override: var(--muted);
    --trees-search-fg-override: var(--foreground);
    --trees-input-bg-override: var(--muted);
    --trees-theme-input-bg-override: var(--muted);
    --trees-theme-input-fg-override: var(--foreground);
  }
`;

function toPierreGitStatus(files: Array<{ path: string; git: GitDiffSummary }>): GitStatusEntry[] {
  const statusMap: Record<string, GitStatusEntry['status']> = {
    modified: 'modified',
    added: 'added',
    deleted: 'deleted',
    renamed: 'renamed',
    copied: 'modified',
    untracked: 'untracked',
    ignored: 'ignored',
  };
  return files.map((file) => ({
    path: file.path,
    status: statusMap[file.git.status] ?? 'modified',
  }));
}

interface FileTreeProps {
  workspaceId: string;
  sdkClient: ProkopaiClient | null;
  onFileSelect?: (target: FileEntryActionTarget) => void;
  root?: string;
  /** Currently open editor path (root-relative), for reveal. */
  activePath?: string;
  /** Root the activePath belongs to ('' for the main root). */
  activeRoot?: string;
}

export interface FileTreeHandle {
  refresh: () => void;
  focus: () => void;
  /** Focus the in-tree filter input. */
  focusSearch: () => void;
}

/**
 * Project tree rendered by @pierre/trees. One model instance drives
 * everything; data arrives imperatively:
 *
 * - full path lists (with find-style `dir/` markers from `/files/tree`) go
 *   through `resetPaths` so expansion and selection survive refreshes,
 * - git status decorations follow the shared git-status query,
 * - the active editor file is revealed with scrollToPath.
 */
export const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(
  ({ workspaceId, sdkClient, onFileSelect, root, activePath, activeRoot }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const pathsQuery = useFileTreeFullQuery(sdkClient, workspaceId, root);
    const { data: pathsData, isLoading, error, refetch } = pathsQuery;
    const gitStatusQuery = useGitStatusQuery(sdkClient, workspaceId, root);
    const paths = useMemo(() => pathsData?.paths ?? [], [pathsData?.paths]);
    /** Tree identity for expansion persistence (workspace + selected root). */
    const stateKey = `${workspaceId}:${root ?? ''}`;

    // Construct-once model: onSelectionChange is frozen at first render, so
    // live props are read through a ref kept current every render. The remount
    // key covers workspace/root changes today, but the handler must not rely
    // on that for callback identity.
    const liveRef = useRef({ onFileSelect, root, sdkClient });
    useEffect(() => {
      liveRef.current = { onFileSelect, root, sdkClient };
    });

    const { model } = useFileTree({
      paths,
      icons: { set: 'standard', colored: true },
      search: true,
      fileTreeSearchMode: 'hide-non-matches',
      dragAndDrop: false,
      renaming: false,
      onSelectionChange: ((selectedPaths: readonly string[]) => {
        const first = selectedPaths[0];
        if (!first) return;
        const { onFileSelect, root, sdkClient } = liveRef.current;
        if (!onFileSelect || !sdkClient) return;
        const name = first.split('/').pop() ?? first;
        activatePierreFileSelection(model, first, () => {
          onFileSelect({
            entry: { name, type: 'file', path: first },
            root,
          });
        });
      }) satisfies FileTreeSelectionChangeListener,
    });

    // Query refreshes replace model contents in place. resetPaths rebuilds
    // the expansion map, so previously opened directories are re-passed as
    // initialExpandedPaths from the persisted per-workspace store.
    const prevPathsRef = useRef<string[] | null>(null);
    useEffect(() => {
      if (prevPathsRef.current === paths) return;
      prevPathsRef.current = paths;
      const restored = fileTreeExpandedPaths(stateKey);
      model.resetPaths(paths, { initialExpandedPaths: restored });
    }, [paths, model, stateKey]);

    // Capture expansion changes so refreshes and reloads keep your place.
    // An expanded directory is always a visible row, so one flat scan
    // yields every open dir. Skipped while the built-in search is active:
    // hide-non-matches hides unrelated branches and would snapshot garbage.
    const expandedSignature = useRef('');
    useEffect(() => {
      const capture = () => {
        if (model.getSearchValue().length > 0 || model.isSearchOpen()) return;
        const count = model.getVisibleCount();
        if (count === 0) return;
        const openDirs = model
          .getVisibleRows(0, count)
          .filter((row) => row.kind === 'directory' && row.isExpanded)
          .map((row) => row.path);
        const signature = JSON.stringify(openDirs);
        if (signature === expandedSignature.current) return;
        expandedSignature.current = signature;
        useFileTreeStateStore.getState().recordExpanded(stateKey, openDirs);
      };
      capture();
      return model.subscribe(capture);
    }, [model, stateKey]);

    const appliedGitSignature = useRef('');
    const statusFiles = gitStatusQuery.data?.files;

    useEffect(() => {
      if (!statusFiles) return;
      const entries = toPierreGitStatus(statusFiles);
      const signature = JSON.stringify(entries);
      if (signature === appliedGitSignature.current) return;
      appliedGitSignature.current = signature;
      model.setGitStatus(entries);
    }, [statusFiles, model]);

    // Reveal the active editor file when it changes under this root.
    const revealedActive = useRef('');
    useEffect(() => {
      const key = `${activeRoot ?? ''}\u0000${activePath ?? ''}`;
      if (!activePath || revealedActive.current === key) return;
      if ((activeRoot ?? '') !== (root ?? '')) return;
      revealedActive.current = key;
      model.scrollToPath(activePath, { offset: 'center' });
    }, [activePath, activeRoot, root, model]);

    useImperativeHandle(ref, () => ({
      refresh: () => {
        void refetch();
      },
      focus: () => {
        // Pierre marks the model-focused row with tabIndex 0 (all others -1);
        // real keyboard nav needs document focus on that row element. Rows
        // may live in light DOM or inside one or more shadow roots depending
        // on custom-element upgrade timing, so the lookup walks every scope
        // under the host (plain querySelector never crosses a shadow
        // boundary). Retries cover late upgrades/render passes.
        model.focusFirstItem();
        const host = containerRef.current;
        if (!host) return;
        let attempts = 0;
        const focusFocusedRow = () => {
          attempts += 1;
          const scopes: ParentNode[] = [host];
          // Collect shadow roots depth-first, including nested wrappers.
          const collect = (root: ParentNode) => {
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) {
                scopes.push(el.shadowRoot);
                collect(el.shadowRoot);
              }
            }
          };
          collect(host);

          for (const scope of scopes) {
            const row = scope.querySelector<HTMLElement>(
              '[tabindex]:not([tabindex="-1"])',
            );
            if (row) {
              row.focus();
              return;
            }
          }
          if (attempts < 10) window.setTimeout(focusFocusedRow, 100);
        };
        window.setTimeout(focusFocusedRow, 0);
      },
      focusSearch: () => {
        model.openSearch('');
      },
    }), [refetch, model]);

    const retryRefetch = useCallback(() => {
      void refetch();
    }, [refetch]);

    if (isLoading && paths.length === 0) {
      return (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Loading files...
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load files'}
          <Button variant="ghost" size="sm" onClick={retryRefetch} className="ml-2">
            <RefreshCw className="size-3" />
          </Button>
        </div>
      );
    }

    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        <style>{TREE_THEME_CSS}</style>
        <div ref={containerRef} className="h-full w-full" data-pierre-file-tree>
          <PierreFileTreeReact model={model} className="size-full" />
        </div>
      </div>
    );
  },
);

FileTree.displayName = 'FileTree';
