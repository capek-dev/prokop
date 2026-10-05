import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';

const FILES_CHANGED_DEBOUNCE_MS = 300;

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function invalidateWorkspaceFileQueries(workspaceId: string): void {
  // File contents and listings only. Git status is pushed by the server's
  // throttled status feed, and a moved HEAD (an agent committing through the
  // shell) refreshes branch views from that push (`handleGitStatus`).
  for (const prefix of [
    queryKeys.files.browsePrefix,
    queryKeys.files.treePrefix,
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

/** Test seam: flush pending debounced invalidations immediately. */
export function flushFilesChangedForTest(): void {
  for (const [workspaceId, timer] of pendingTimers) {
    clearTimeout(timer);
    pendingTimers.delete(workspaceId);
    invalidateWorkspaceFileQueries(workspaceId);
  }
}
