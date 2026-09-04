/**
 * Inward-facing terminal session persistence port (S5 PTY/terminal
 * persistence isolation). The terminal transport manager keeps PTY,
 * ServerWebSocket, buffers, reconnect, frame/event, and process lifecycle
 * ownership and accesses persistence only through this port.
 *
 * The port carries the exact pre-slice `store/terminal-sessions` function
 * signatures with structural local types only: no SDK types and no SQL
 * cross this boundary. `TerminalSessionRow` is the exact old store row
 * shape, and the repository implements this port verbatim so the store
 * compat forwarder can delegate all ten exports.
 */

export interface TerminalSessionRow {
  id: string;
  workspace_id: string;
  cwd: string;
  shell: string;
  title: string;
  status: 'running' | 'exited' | 'destroyed';
  exit_code: number | null;
  pid: number | null;
  cols: number;
  rows: number;
  created_at: number;
  last_activity_at: number;
  destroyed_at: number | null;
  managed_worktree_id: string | null;
}

export interface CreateTerminalSessionInput {
  id: string;
  workspaceId: string;
  cwd: string;
  shell: string;
  pid: number;
  cols: number;
  rows: number;
  managedWorktreeId?: string;
}

export interface TerminalSessionStorePort {
  createTerminalSession(session: CreateTerminalSessionInput): void;
  updateTerminalSessionTitle(id: string, title: string): void;
  updateTerminalSessionActivity(id: string): void;
  markTerminalSessionExited(id: string, exitCode: number): void;
  markTerminalSessionDestroyed(id: string): void;
  getTerminalSession(id: string): TerminalSessionRow | null;
  listTerminalSessions(workspaceId: string): TerminalSessionRow[];
  listActiveTerminalSessions(workspaceId: string): TerminalSessionRow[];
  cleanupStaleTerminalSessions(): number;
  cleanupRunningSessionsOnStartup(): number;
}
