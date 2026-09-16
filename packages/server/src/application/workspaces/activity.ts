type ActivityListener = (workspaceId: string, lastConversationAt: number | null) => void;
let listener: ActivityListener | undefined;

/** Installed by the host transport. Persistence does not depend on WebSocket delivery. */
export function installWorkspaceActivityListener(next: ActivityListener | undefined): void {
  listener = next;
}

export function notifyWorkspaceActivity(workspaceId: string, lastConversationAt: number | null): void {
  try {
    listener?.(workspaceId, lastConversationAt);
  } catch (error: unknown) {
    console.error('[workspace] Activity delivery failed', error);
  }
}
