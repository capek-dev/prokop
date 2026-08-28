import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import type { GitDiffSummary, ProkopaiClient } from '@prokopai/sdk';
import type {
  FileTreeSelectionChangeListener,
  GitStatusEntry,
} from '@pierre/trees';
import { FileTree as PierreFileTreeReact, useFileTree } from '@pierre/trees/react';
import type { FileEntryActionTarget } from './FileEntryContextMenu';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useGitStatusQuery } from '@/hooks/queries/useFileQueries';
import { useFileTreeStateStore } from '@/stores/fileTreeStateStore';
import {
  activatePierreFileSelection,
  PierreTreeHost,
  focusFocusedPierreRow,
} from './pierreTreeHost';

export interface GitChangesViewHandle {
  focus: () => void;
}

interface GitChangesViewProps {
  workspaceId: string;
  sdkClient: ProkopaiClient | null;
  root?: string;
  onFileSelect: (target: FileEntryActionTarget) => void;
}

type ChangedFile = { path: string; git: GitDiffSummary };

const REASON_LABELS: Record<string, string> = {
  git_not_installed: 'Git is not installed',
  not_a_git_repo: 'Not a git repository',
  git_error: 'Unable to read git status',
};

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Our wire status -> the tree's decoration statuses (copied over). */
function toPierreEntries(files: ChangedFile[]): GitStatusEntry[] {
  const statusMap: Record<string, GitStatusEntry['status']> = {
    modified: 'modified',
    added: 'added',
    deleted: 'deleted',
    renamed: 'renamed',
    copied: 'modified',
    untracked: 'untracked',
    ignored: 'ignored',
  };
  return files.map((f) => ({
    path: f.path,
    status: statusMap[f.git.status] ?? 'modified',
  }));
}

export function summarizeDiffStats(files: ChangedFile[]): { additions: number; deletions: number; hasCounts: boolean; fileCount: number } {
  let additions = 0;
  let deletions = 0;
  let hasCounts = false;
  for (const f of files) {
    if (f.git.additions !== undefined || f.git.deletions !== undefined) {
      hasCounts = true;
      additions += f.git.additions ?? 0;
      deletions += f.git.deletions ?? 0;
    }
  }
  return { additions, deletions, hasCounts, fileCount: files.length };
}

/**
 * Maps a tree-selected id onto an opener target, or null when the row must
 * not open anything: directory ids (trailing slash), paths that are not in
 * the current changed set, and legacy parity (deleted entries never opened;
 * their preview lives in the Project tab). The caller injects `root`.
 */
export function buildSelectionTarget(
  files: readonly ChangedFile[],
  selectedPath: string,
): Omit<FileEntryActionTarget, 'root'> | null {
  const changed = files.find((entry) => entry.path === selectedPath);
  if (!changed || changed.git.status === 'deleted') return null;
  return {
    entry: {
      name: basename(selectedPath),
      type: 'file',
      path: selectedPath,
      extension: selectedPath.includes('.')
        ? `.${selectedPath.split('.').pop()}`
        : undefined,
      git: changed.git,
    },
  };
}

/**
 * Every ancestor directory of the given leaf paths, with the find-style
 * trailing slash ("src/" from "src/a.ts"). Feeds flat-mode expansion so the
 * whole subtree renders at once.
 */
export function allAncestorDirectories(paths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const path of paths) {
    const segments = path.split('/');
    segments.pop();
    let current = '';
    for (const segment of segments) {
      current = current.length === 0 ? `${segment}/` : `${current}${segment}/`;
      out.add(current);
    }
  }
  return [...out].sort();
}

/**
 * Changed-files tree on the shared Pierre engine. Always tree-structured;
 * every branch starts open (VSCode SCM behavior) and user collapses persist
 * across refreshes and reloads via the shared per-workspace store.
 */
export const GitChangesView = forwardRef<GitChangesViewHandle, GitChangesViewProps>(
  ({ workspaceId, sdkClient, root, onFileSelect }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { data, isLoading, error, refetch } = useGitStatusQuery(sdkClient, workspaceId, root);

    // Persisted expansion identity mirrors the Project tree but under a
    // dedicated namespace so neither view clobbers the other's place.
    const stateKey = `changes:${workspaceId}:${root ?? ''}`;
    // null = the user has never collapsed anything here, so branches start
    // fully open instead of collapsing to an empty persisted set.
    const persistedExpanded = useFileTreeStateStore((s) => s.byKey[stateKey]) ?? null;

    const availability = data?.availability;
    const allFiles = data?.files ?? [];

    // Filtering lives in the tree's built-in search (hide-non-matches, same
    // as the Project tab); the host always receives the full changed set.
    const files = allFiles;

    // Leaf-file path list. Pure leaf inputs need no trailing-slash markers:
    // the builder auto-creates implicit intermediate directories, and leaf
    // names can never collide with an implicit dir unless the repo contains
    // a real file/directory naming conflict.
    const paths = useMemo(() => files.map((f) => f.path), [files]);
    const allAncestors = useMemo(() => allAncestorDirectories(paths), [paths]);

    // Expansion = all branches open unless the user collapsed them. The
    // persisted store lists dirs that were open at last snapshot; a dir in
    // allAncestors but absent there was explicitly closed, so it stays shut.
    const expandedForReset = useMemo(() => {
      if (persistedExpanded === null) return allAncestors;
      return allAncestors.filter((dir) => persistedExpanded.includes(dir));
    }, [allAncestors, persistedExpanded]);

    // Construct-once model: onSelectionChange is frozen at first render, so
    // live values are read through a ref kept current every render. This view
    // does NOT remount on workspace switches (no key), so a captured `files`
    // list would keep targeting the previous repo and clicks would stop
    // opening files.
    const liveRef = useRef({ files, onFileSelect, root, sdkClient });
    useEffect(() => {
      liveRef.current = { files, onFileSelect, root, sdkClient };
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
        const { files, onFileSelect, root, sdkClient } = liveRef.current;
        if (!onFileSelect || !sdkClient) return;
        const target = buildSelectionTarget(files, first);
        // File rows always deselect: Pierre only emits onSelectionChange when
        // selection changes, so a stranded selection would swallow every
        // later click on that row.
        activatePierreFileSelection(
          model,
          first,
          target ? () => onFileSelect({ ...target, root }) : undefined,
        );
      }) satisfies FileTreeSelectionChangeListener,
    });

    // Query refreshes AND mode flips rebuild the store. Mode must be part of
    // the guard: grouped keeps the persisted expansion, flat expands every
    // Rebuild on data change only. Branches start fully open (VSCode SCM
    const prevPathsRef = useRef<string[] | null>(null);
    useEffect(() => {
      if (prevPathsRef.current === paths) return;
      prevPathsRef.current = paths;
      model.resetPaths(paths, { initialExpandedPaths: expandedForReset });
    }, [paths, model, expandedForReset]);

    const appliedGitSignature = useRef('');
    useEffect(() => {
      const entries = toPierreEntries(files);
      const signature = JSON.stringify(entries);
      if (signature === appliedGitSignature.current) return;
      appliedGitSignature.current = signature;
      model.setGitStatus(entries);
    }, [files, model]);

    // Capture collapses (and re-opens) whenever the visible rows change.
    const expandedSignature = useRef('');
    useEffect(() => {
      const capture = () => {
        // Skipped while the built-in search is active: hide-non-matches
        // hides unrelated branches and would snapshot garbage.
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

    useImperativeHandle(ref, () => ({
      focus: () => {
        focusFocusedPierreRow(containerRef.current);
      },
    }), []);

    if (isLoading && allFiles.length === 0) {
      return (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Loading changes...
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center p-4 text-sm text-destructive">
          {error.message}
          <Button variant="ghost" size="sm" onClick={() => void refetch()} className="ml-2">
            <RefreshCw className="size-3" />
          </Button>
        </div>
      );
    }

    if (availability && !availability.available) {
      const label = availability.reason
        ? REASON_LABELS[availability.reason] ?? 'Git unavailable'
        : 'Git unavailable';
      return <div className="p-4 text-sm text-muted-foreground text-center">{label}</div>;
    }

    if (allFiles.length === 0) {
      return <div className="p-4 text-sm text-muted-foreground text-center">No changes</div>;
    }

    return (
      // Flex column so the tree host's flex-1/h-full resolve instead of
      // collapsing to zero height inside this plain div.
      <div className="flex flex-1 min-h-0 min-w-0 w-full flex-col outline-none">
        <PierreTreeHost hostRef={containerRef}>
          <PierreFileTreeReact model={model} className="size-full" />
        </PierreTreeHost>
      </div>
    );
  },
);

GitChangesView.displayName = 'GitChangesView';
