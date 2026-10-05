import type { FileTreeResponse, FileTreeUpdate } from '@prokopai/sdk';
import { queryClient } from '@/components/providers/QueryProvider';
import { applyFileTreeDelta } from '@/lib/fileTreePaths';
import { queryKeys } from '@/lib/queryKeys';

const FILES_CHANGED_DEBOUNCE_MS = 300;

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function invalidateWorkspaceFileQueries(workspaceId: string): void {
  // File contents and listings only. Git status and the file tree are pushed
  // by the server's throttled feeds (`handleGitStatus`, `handleFileTree`),
  // and a moved HEAD (an agent committing through the shell) refreshes
  // branch views from the status push.
  for (const prefix of [
    queryKeys.files.browsePrefix,
    queryKeys.files.searchPrefix,
    ['files', 'git-diff'],
    ['files', 'preview'],
  ]) {
    void queryClient.invalidateQueries({ queryKey: [...prefix, workspaceId] });
  }
}

/**
 * Workspace files may have changed: a mutating tool completed in any session
 * of the workspace (server `files.changed` broadcast, or the part-updated
 * fallback for sessions this client participates in), or a rollback ran.
 * Debounced per workspace so a burst of tool completions invalidates once.
 */
export function handleFilesChanged(workspaceId: string): void {
  if (typeof workspaceId !== 'string' || !workspaceId) return;
  const existing = pendingTimers.get(workspaceId);
  if (existing !== undefined) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingTimers.delete(workspaceId);
    invalidateWorkspaceFileQueries(workspaceId);
  }, FILES_CHANGED_DEBOUNCE_MS);
  pendingTimers.set(workspaceId, timer);
}

/**
 * Pushed tree change for a watched root. A snapshot replaces an older cached
 * tree; a delta applies only on top of the exact revision it was computed
 * from, and a cache that missed a revision refetches instead.
 */
export function handleFileTree(workspaceId: string, root: string, update: FileTreeUpdate): void {
  const queries = queryClient.getQueriesData<FileTreeResponse>({
    queryKey: [...queryKeys.files.treePrefix, workspaceId],
  });
  for (const [key, current] of queries) {
    if (current?.root !== root) continue;
    const held = current.revision ?? 0;
    if (update.kind === 'snapshot') {
      if ((update.tree.revision ?? 0) > held) queryClient.setQueryData(key, update.tree);
    } else if (held === update.baseRevision) {
      queryClient.setQueryData(key, applyFileTreeDelta(current, update));
    } else if (held < update.revision) {
      void queryClient.invalidateQueries({ queryKey: key, exact: true });
    }
  }
}

/** Test seam: flush pending debounced invalidations immediately. */
export function flushFilesChangedForTest(): void {
  for (const [workspaceId, timer] of pendingTimers) {
    clearTimeout(timer);
    pendingTimers.delete(workspaceId);
    invalidateWorkspaceFileQueries(workspaceId);
  }
}
