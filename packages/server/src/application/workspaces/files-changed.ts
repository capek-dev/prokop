type FilesChangedListener = (workspaceId: string) => void;
let listener: FilesChangedListener | undefined;
const observers = new Set<FilesChangedListener>();

/** Installed by the host transport. Persistence does not depend on WebSocket delivery. */
export function installWorkspaceFilesChangedListener(next: FilesChangedListener | undefined): void {
  listener = next;
}

/** Server-side consumers (the Git status feed) alongside the transport listener. */
export function addWorkspaceFilesChangedObserver(observer: FilesChangedListener): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

/**
 * A tool whose completion may have changed workspace files reached a terminal
 * state. Emitted from the message-store side-effect layer for every harness;
 * delivery is a workspace-scoped `files.changed` broadcast.
 */
export function notifyWorkspaceFilesChanged(workspaceId: string): void {
  for (const notify of [listener, ...observers]) {
    try {
      notify?.(workspaceId);
    } catch (error: unknown) {
      console.error('[workspace] Files-changed delivery failed', error);
    }
  }
}
