import type { Database } from 'bun:sqlite';
import type {
  AttentionAsk,
  AttentionRunningSession,
  AttentionSourcePort,
} from '@/application/ports/attention';
import { onAttentionChanged } from './attention-signals';

interface AskRow {
  id: string;
  is_permission: number;
  session_id: string;
  session_title: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  tool_name: string;
  created_at: number;
}

interface RunningRow {
  id: string;
  title: string | null;
  workspace_id: string;
  workspace_name: string | null;
  running_at: string;
}

/** Reads the attention lists from SQLite and follows the attention signal. */
export function createAttentionSource(getDatabase: () => Database): AttentionSourcePort {
  return {
    pendingAsks(): AttentionAsk[] {
      return getDatabase()
        .query<AskRow, []>(
          `SELECT a.id, a.is_permission, root.id AS session_id, root.title AS session_title,
                  root.workspace_id, w.name AS workspace_name, a.tool_name, a.created_at
           FROM pending_asks a
           JOIN sessions root ON root.id = COALESCE(a.root_session_id, a.session_id)
           LEFT JOIN workspaces w ON w.id = root.workspace_id
           WHERE a.status = 'pending'
           ORDER BY a.created_at ASC`,
        )
        .all()
        .map((row) => ({
          id: row.id,
          kind: row.is_permission ? 'approval' as const : 'question' as const,
          sessionId: row.session_id,
          sessionTitle: row.session_title,
          workspaceId: row.workspace_id,
          workspaceName: row.workspace_name,
          toolName: row.tool_name,
          createdAt: row.created_at,
        }));
    },

    runningSessions(): AttentionRunningSession[] {
      return getDatabase()
        .query<RunningRow, []>(
          `SELECT s.id, s.title, s.workspace_id, w.name AS workspace_name, s.running_at
           FROM sessions s
           LEFT JOIN workspaces w ON w.id = s.workspace_id
           WHERE s.running_at IS NOT NULL AND s.parent_id IS NULL
           ORDER BY s.running_at ASC`,
        )
        .all()
        .map((row) => ({
          sessionId: row.id,
          sessionTitle: row.title,
          workspaceId: row.workspace_id,
          workspaceName: row.workspace_name,
          runningAt: row.running_at,
        }));
    },

    subscribe: onAttentionChanged,
  };
}
