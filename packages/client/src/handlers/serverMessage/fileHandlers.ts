import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';
import { handleGitChanged } from './gitHandlers';

const FILES_CHANGED_DEBOUNCE_MS = 300;

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function invalidateWorkspaceFileQueries(workspaceId: string): void {
  // A file-mutating tool completion can also move refs (an agent running git
  // through the shell emits no git.changed, which only UI/workbench mutations
  // emit), so reuse the full git invalidation set from the git.changed
  // handler: status, history, branches, repository, rebase, worktree refs,
  // plus browse/tree/git-diff. Search and preview are files-only additions.
  handleGitChanged(workspaceId);
  void queryClient.invalidateQueries({ queryKey: [...queryKeys.files.searchPrefix, workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ['files', 'preview', workspaceId] });
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
