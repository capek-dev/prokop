import { getDatabase } from '@/infrastructure/sqlite/database';

export interface CodexBinding {
  sessionId: string;
  threadId: string;
  cliVersion: string;
  workspaceRoot: string;
  pendingTurn: boolean;
  pendingUserId: string | null;
  pendingAssistantId: string | null;
  pendingTurnId: string | null;
  goalRootTurnId: string | null;
  goalRequested: boolean;
}

export function getCodexBinding(sessionId: string): CodexBinding | null {
  const row = getDatabase().query<{
    session_id: string; thread_id: string; cli_version: string; workspace_root: string; pending_turn: number;
    pending_user_id: string | null; pending_assistant_id: string | null;
    pending_turn_id: string | null; goal_root_turn_id: string | null; goal_requested: number;
  }, [string]>(`SELECT session_id, thread_id, cli_version, workspace_root, pending_turn, pending_user_id, pending_assistant_id,
      pending_turn_id, goal_root_turn_id, goal_requested
    FROM codex_session_bindings WHERE session_id = ?`).get(sessionId);
  return row ? {
    sessionId: row.session_id, threadId: row.thread_id,
    cliVersion: row.cli_version, workspaceRoot: row.workspace_root, pendingTurn: row.pending_turn !== 0,
    pendingUserId: row.pending_user_id, pendingAssistantId: row.pending_assistant_id,
    pendingTurnId: row.pending_turn_id, goalRootTurnId: row.goal_root_turn_id,
    goalRequested: row.goal_requested !== 0,
  } : null;
}

export function bindCodexThread(binding: Pick<CodexBinding, 'sessionId' | 'threadId' | 'cliVersion' | 'workspaceRoot'>): void {
  // Never rebind an existing Prokop session or silently switch a Codex thread.
  getDatabase().run(`INSERT INTO codex_session_bindings
    (session_id, thread_id, cli_version, workspace_root, created_at)
    SELECT id, ?, ?, ?, ? FROM sessions WHERE id = ? AND harness = 'codex-cli'`, [
    binding.threadId, binding.cliVersion, binding.workspaceRoot,
    new Date().toISOString(), binding.sessionId,
  ]);
  if (!getCodexBinding(binding.sessionId)) throw new Error('Codex session no longer exists');
}

/** Records the CLI that last resumed the thread. Upgrades never strand a session. */
export function recordCodexCliVersion(sessionId: string, version: string): void {
  getDatabase().run('UPDATE codex_session_bindings SET cli_version = ? WHERE session_id = ?', [version, sessionId]);
}

export function markCodexTurnPending(sessionId: string, userId: string, assistantId: string): void {
  const result = getDatabase().run(`UPDATE codex_session_bindings
    SET pending_turn = 1, pending_user_id = ?, pending_assistant_id = ?, pending_turn_id = NULL,
      goal_root_turn_id = NULL, goal_requested = 0
    WHERE session_id = ? AND pending_turn = 0`, [userId, assistantId, sessionId]);
  if (result.changes !== 1) throw new Error('Codex turn requires reconciliation before another send');
}

export function markCodexTurnStarted(sessionId: string, turnId: string, assistantId: string,
  continuation: boolean): void {
  const result = getDatabase().run(`UPDATE codex_session_bindings
    SET pending_turn_id = ?, pending_assistant_id = ?, goal_root_turn_id = CASE WHEN ? = 1
      THEN goal_root_turn_id ELSE ? END
    WHERE session_id = ? AND pending_turn = 1 AND pending_user_id IS NOT NULL
      AND (pending_turn_id IS NULL OR ? = 1 AND goal_root_turn_id IS NOT NULL)`, [
    turnId, assistantId, continuation ? 1 : 0, turnId, sessionId, continuation ? 1 : 0,
  ]);
  if (result.changes !== 1) throw new Error('Codex continuation identity is unavailable');
}

export function markCodexGoalRequested(sessionId: string): void {
  const result = getDatabase().run(`UPDATE codex_session_bindings SET goal_requested = 1
    WHERE session_id = ? AND pending_turn = 1 AND pending_turn_id IS NOT NULL`, [sessionId]);
  if (result.changes !== 1) throw new Error('Codex goal activation has no turn identity');
}

export function markCodexGoalUncertain(sessionId: string): void {
  getDatabase().run('UPDATE codex_session_bindings SET goal_requested = 1 WHERE session_id = ?', [sessionId]);
}

export function markCodexTurnCompleted(sessionId: string): void {
  getDatabase().run(`UPDATE codex_session_bindings
    SET pending_turn = 0, pending_user_id = NULL, pending_assistant_id = NULL,
      pending_turn_id = NULL, goal_root_turn_id = NULL, goal_requested = 0 WHERE session_id = ?`, [sessionId]);
}
