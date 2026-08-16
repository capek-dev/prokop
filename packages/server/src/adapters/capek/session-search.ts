import {
  configureSessionSearchHost,
  type SessionSearchHost,
} from '@capekai/core/compat/jean2';
import {
  getDatabase,
  getSession,
  getSessionsByAgent,
  getWorkspace,
  listSessionsByWorkspace,
} from '@/store';
import { getMessageContentForFts, searchMessages } from '@/session-search/fts';

export const jean2SessionSearchHost: SessionSearchHost = {
  getWorkspace,
  getSession,
  listWorkspaceSessions: (workspaceId) => listSessionsByWorkspace(workspaceId, { rootOnly: true }),
  listAgentSessions: (agentId, limit) => getSessionsByAgent(agentId, undefined, limit),
  countSessionMessages(sessionId) {
    return (getDatabase().query(
      'SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?',
    ).get(sessionId) as { cnt: number }).cnt;
  },
  searchMessages,
  countMessagesBefore(sessionId, timestamp) {
    return (getDatabase().query(
      'SELECT COUNT(*) as cnt FROM messages WHERE session_id = ? AND created_at < ?',
    ).get(sessionId, timestamp) as { cnt: number }).cnt;
  },
  countMessagesAfter(sessionId, timestamp) {
    return (getDatabase().query(
      'SELECT COUNT(*) as cnt FROM messages WHERE session_id = ? AND created_at > ?',
    ).get(sessionId, timestamp) as { cnt: number }).cnt;
  },
  getLatestMessage(sessionId) {
    const row = getDatabase().query(
      'SELECT id, created_at FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
    ).get(sessionId) as { id: string; created_at: number } | undefined;
    return row ? { id: row.id, timestamp: row.created_at } : null;
  },
  getMessage(messageId, sessionId) {
    const row = getDatabase().query(
      'SELECT id, created_at FROM messages WHERE id = ? AND session_id = ?',
    ).get(messageId, sessionId) as { id: string; created_at: number } | undefined;
    return row ? { id: row.id, timestamp: row.created_at } : null;
  },
  listMessagesBefore(sessionId, timestamp, limit) {
    const rows = getDatabase().query(
      'SELECT id, role, created_at FROM messages WHERE session_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?',
    ).all(sessionId, timestamp, limit) as Array<{ id: string; role: string; created_at: number }>;
    return rows.map((row) => ({ id: row.id, role: row.role, timestamp: row.created_at }));
  },
  listMessagesAfter(sessionId, timestamp, limit) {
    const rows = getDatabase().query(
      'SELECT id, role, created_at FROM messages WHERE session_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?',
    ).all(sessionId, timestamp, limit) as Array<{ id: string; role: string; created_at: number }>;
    return rows.map((row) => ({ id: row.id, role: row.role, timestamp: row.created_at }));
  },
  getMessageSummary(messageId) {
    const row = getDatabase().query(
      'SELECT role, created_at FROM messages WHERE id = ?',
    ).get(messageId) as { role: string; created_at: number } | undefined;
    if (!row) return null;
    const { content, toolName } = getMessageContentForFts(messageId);
    return { role: row.role, timestamp: row.created_at, content, toolName };
  },
};

export function configureJean2SessionSearchHost(): void {
  configureSessionSearchHost(jean2SessionSearchHost);
}
