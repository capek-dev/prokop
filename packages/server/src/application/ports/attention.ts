/** A pending approval or question; points at the top-level session the user opens. */
export interface AttentionAsk {
  id: string;
  kind: 'approval' | 'question';
  /** Top-level session to open (a subagent's ask surfaces on its root session). */
  sessionId: string;
  sessionTitle: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  toolName: string;
  createdAt: number;
}

export interface AttentionRunningSession {
  sessionId: string;
  sessionTitle: string | null;
  workspaceId: string;
  workspaceName: string | null;
  runningAt: string;
}

export interface AttentionSourcePort {
  pendingAsks(): AttentionAsk[];
  runningSessions(): AttentionRunningSession[];
  /** Called after writes that may change either list; returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}
