/**
 * S5 terminal session repository: SQL and row mapping for terminal_sessions
 * over an injected database accessor. The SQL statements, parameter order,
 * timestamps, row shape, and list filters are byte-for-byte the pre-slice
 * `store/terminal-sessions` implementation; only the database accessor is
 * injected instead of the store singleton.
 */

import type { Database } from 'bun:sqlite';
import type {
  CreateTerminalSessionInput,
  TerminalSessionRow,
  TerminalSessionStorePort,
} from '@/application/ports/terminal';

export type TerminalDatabaseAccessor = () => Database;

export function createTerminalSessionRepository(
  getDb: TerminalDatabaseAccessor,
): TerminalSessionStorePort {
  return {
    createTerminalSession(session: CreateTerminalSessionInput): void {
      const now = Date.now();
      getDb().run(
        `INSERT INTO terminal_sessions (id, workspace_id, cwd, shell, pid, cols, rows, managed_worktree_id, title, status, created_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'main', 'running', ?, ?)`,
        [
          session.id,
          session.workspaceId,
          session.cwd,
          session.shell,
          session.pid,
          session.cols,
          session.rows,
          session.managedWorktreeId ?? null,
          now,
          now,
        ]
      );
    },

    updateTerminalSessionTitle(id: string, title: string): void {
      getDb().run(
        `UPDATE terminal_sessions SET title = ? WHERE id = ?`,
        [title, id]
      );
    },

    updateTerminalSessionActivity(id: string): void {
      const now = Date.now();
      getDb().run(
        `UPDATE terminal_sessions SET last_activity_at = ? WHERE id = ?`,
        [now, id]
      );
    },

    markTerminalSessionExited(id: string, exitCode: number): void {
      const now = Date.now();
      getDb().run(
        `UPDATE terminal_sessions SET status = 'exited', exit_code = ?, last_activity_at = ? WHERE id = ?`,
        [exitCode, now, id]
      );
    },

    markTerminalSessionDestroyed(id: string): void {
      const now = Date.now();
      getDb().run(
        `UPDATE terminal_sessions SET status = 'destroyed', destroyed_at = ?, last_activity_at = ? WHERE id = ?`,
        [now, now, id]
      );
    },

    getTerminalSession(id: string): TerminalSessionRow | null {
      const row = getDb().query(
        `SELECT * FROM terminal_sessions WHERE id = ?`
      ).get(id) as TerminalSessionRow | undefined;
      return row ?? null;
    },

    listTerminalSessions(workspaceId: string): TerminalSessionRow[] {
      return getDb().query(
        `SELECT * FROM terminal_sessions WHERE workspace_id = ? ORDER BY created_at ASC`
      ).all(workspaceId) as TerminalSessionRow[];
    },

    listActiveTerminalSessions(workspaceId: string): TerminalSessionRow[] {
      return getDb().query(
        `SELECT * FROM terminal_sessions WHERE workspace_id = ? AND status IN ('running', 'exited') ORDER BY created_at ASC`
      ).all(workspaceId) as TerminalSessionRow[];
    },

    cleanupStaleTerminalSessions(): number {
      const cutoff = Date.now() - 60 * 60 * 1000;
      const result = getDb().run(
        `DELETE FROM terminal_sessions WHERE status = 'destroyed' AND destroyed_at < ?`,
        [cutoff]
      );
      return result.changes;
    },

    cleanupRunningSessionsOnStartup(): number {
      const result = getDb().run(
        `UPDATE terminal_sessions SET status = 'destroyed', destroyed_at = ? WHERE status = 'running'`,
        [Date.now()]
      );
      return result.changes;
    },
  };
}
