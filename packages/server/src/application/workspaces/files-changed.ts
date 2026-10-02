type FilesChangedListener = (workspaceId: string) => void;
let listener: FilesChangedListener | undefined;

/** Installed by the host transport. Persistence does not depend on WebSocket delivery. */
export function installWorkspaceFilesChangedListener(next: FilesChangedListener | undefined): void {
  listener = next;
}

/**
 * A tool whose completion may have changed workspace files reached a terminal
 * state. Emitted from the message-store side-effect layer for every harness;
 * delivery is a workspace-scoped `files.changed` broadcast.
 */
export function notifyWorkspaceFilesChanged(workspaceId: string): void {
  try {
    listener?.(workspaceId);
  } catch (error: unknown) {
    console.error('[workspace] Files-changed delivery failed', error);
  }
}
