import { getDatabase } from '@/infrastructure/sqlite/database';

export interface CodexBinding {
  sessionId: string;
  threadId: string;
  cliVersion: string;
  workspaceRoot: string;
  pendingTurn: boolean;
  pendingUserId: string | null;
  pendingAssistantId: string | null;
}

export function getCodexBinding(sessionId: string): CodexBinding | null {
  const row = getDatabase().query<{
    session_id: string; thread_id: string; cli_version: string; workspace_root: string; pending_turn: number;
    pending_user_id: string | null; pending_assistant_id: string | null;
  }, [string]>(`SELECT session_id, thread_id, cli_version, workspace_root, pending_turn, pending_user_id, pending_assistant_id
    FROM codex_session_bindings WHERE session_id = ?`).get(sessionId);
  return row ? {
    sessionId: row.session_id, threadId: row.thread_id,
    cliVersion: row.cli_version, workspaceRoot: row.workspace_root, pendingTurn: row.pending_turn !== 0,
    pendingUserId: row.pending_user_id, pendingAssistantId: row.pending_assistant_id,
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

export function markCodexTurnPending(sessionId: string, userId: string, assistantId: string): void {
  const result = getDatabase().run(`UPDATE codex_session_bindings
    SET pending_turn = 1, pending_user_id = ?, pending_assistant_id = ?
    WHERE session_id = ? AND pending_turn = 0`, [userId, assistantId, sessionId]);
  if (result.changes !== 1) throw new Error('Codex turn requires reconciliation before another send');
}

export function markCodexTurnCompleted(sessionId: string): void {
  getDatabase().run(`UPDATE codex_session_bindings
    SET pending_turn = 0, pending_user_id = NULL, pending_assistant_id = NULL WHERE session_id = ?`, [sessionId]);
}
