import { getSession } from '@/infrastructure/sqlite/session-store';
import { notifyWorkspaceFilesChanged } from '@/application/workspaces/files-changed';

/**
 * Rollback dispatch: the CLI restores files as part of the rollback turn and
 * may run no tools afterwards, so the revert site notifies on its own.
 */
export function notifySessionFilesChanged(sessionId: string): void {
  const workspaceId = getSession(sessionId)?.workspaceId;
  if (workspaceId) notifyWorkspaceFilesChanged(workspaceId);
}
