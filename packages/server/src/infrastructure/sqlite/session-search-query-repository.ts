import type { Database } from 'bun:sqlite';
import type { FtsDatabase } from '@/infrastructure/session-search/fts';
import type {
  SessionSearchMessageListItem,
  SessionSearchMessageRef,
  SessionSearchMessageResult,
  SessionSearchMessageSummary,
  SessionSearchOptions,
  SessionSearchQueryPort,
} from '@/application/ports/session-search';

const MAX_SNIPPET_LENGTH = 500;

/** Database accessor injected by the composition root or the S5 compat
 * module. No module-global connection state exists in this layer. */
export type SessionSearchDatabaseAccessor = () => Database;

export function sanitizeFtsQuery(input: string): string {
  let q = input.trim();
  if (!q) return '';

  const quotedPhrases: string[] = [];
  q = q.replace(/"([^"]*)"/g, (_match, content: string) => {
    if (content.trim()) {
      quotedPhrases.push(`"${content.trim()}"`);
    }
    return '';
  });

  q = q.replace(/[{}()[\]\\|~^:=!<>+*/%;]/g, ' ');

  const terms = q
    .split(/\s+/)
    .filter((t) => {
      if (!t) return false;
      const upper = t.toUpperCase();
      return !['AND', 'OR', 'NOT'].includes(upper);
    })
    .map((t) => {
      const cleaned = t.replace(/^-+/, '');
      return cleaned.replace(/-+$/, '');
    })
    .filter((t) => t.length > 0);

  const allParts = [...quotedPhrases, ...terms];

  return allParts.join(' ') || '';
}

// Pre-S5 an empty role filter produced `IN ()`, which failed the primary and
// fallback MATCH and returned []. The external result is preserved, but the
// empty filter now returns early instead of relying on swallowed SQL errors.
export function searchMessages(db: Database, options: SessionSearchOptions): SessionSearchMessageResult[] {
  const { query, workspaceId, agentId, sessionId, roleFilter, limit, sort } = options;

  const ftsQuery = sanitizeFtsQuery(query);
  if (!ftsQuery) return [];
  if (roleFilter.length === 0) return [];

  const rolePlaceholders = roleFilter.map(() => '?').join(', ');
  const conditions: string[] = ['messages_fts MATCH ?'];
  const params: (string | number)[] = [ftsQuery];

  if (workspaceId) {
    conditions.push('fts.workspace_id = ?');
    params.push(workspaceId);
  }
  if (agentId) {
    conditions.push('fts.agent_id = ?');
    params.push(agentId);
  }
  if (sessionId) {
    conditions.push('fts.session_id = ?');
    params.push(sessionId);
  }
  conditions.push(`fts.role IN (${rolePlaceholders})`);
  params.push(...roleFilter);

  const sql = `
    SELECT
      fts.message_id,
      fts.session_id,
      fts.workspace_id,
      fts.role,
      snippet(messages_fts, 5, '...', '...', '...', 32) as snippet,
      m.created_at as timestamp,
      s.title as session_title,
      rank
    FROM messages_fts fts
    JOIN messages m ON m.id = fts.message_id
    JOIN sessions s ON s.id = fts.session_id
    WHERE ${conditions.join(' AND ')}
    ${sort === 'newest' ? 'ORDER BY m.created_at DESC' : sort === 'oldest' ? 'ORDER BY m.created_at ASC' : 'ORDER BY rank'}
    LIMIT ?
  `;
  params.push(limit);

  type SearchRow = {
    message_id: string;
    session_id: string;
    workspace_id: string;
    role: string;
    snippet: string;
    timestamp: number;
    session_title: string | null;
    rank: number;
  };

  // Non-relevance sorts keep the raw row rank exactly as pre-S5.
  const mapRows = (rows: SearchRow[]): SessionSearchMessageResult[] => {
    let rankCounter = 1;
    return rows.map((row) => ({
      messageId: row.message_id,
      sessionId: row.session_id,
      workspaceId: row.workspace_id,
      role: row.role,
      content: row.snippet.slice(0, MAX_SNIPPET_LENGTH),
      timestamp: row.timestamp,
      sessionTitle: row.session_title,
      rank: sort === 'relevance' ? rankCounter++ : row.rank,
    }));
  };

  // Catch-all fallback preserved from pre-S5: a failed primary MATCH retries
  // with the quoted plain query, and a failing fallback returns [] rather
  // than surfacing the error.
  try {
    const rows = db.query(sql).all(...params) as SearchRow[];
    return mapRows(rows);
  } catch {
    const plainQuery = query.replace(/["'*]/g, '').trim();
    if (!plainQuery) return [];

    const fallbackQuery = `"${plainQuery}"`;
    try {
      const rows = db.query(sql).all(fallbackQuery, ...params.slice(1)) as SearchRow[];
      return mapRows(rows);
    } catch {
      return [];
    }
  }
}

export function getMessageContentForFts(
  db: FtsDatabase,
  messageId: string,
): { content: string; toolName: string } {
  const parts = db.query(
    'SELECT type, data FROM parts WHERE message_id = ? ORDER BY created_at ASC',
  ).all(messageId) as Array<{ type: string; data: string }>;

  const textParts: string[] = [];
  const toolNames: string[] = [];

  for (const part of parts) {
    if (part.type === 'text' || part.type === 'reasoning') {
      try {
        const parsed = JSON.parse(part.data);
        if (parsed.text) textParts.push(parsed.text);
      } catch { /* skip */ }
    } else if (part.type === 'tool') {
      try {
        const parsed = JSON.parse(part.data);
        if (parsed.name) toolNames.push(parsed.name);
      } catch { /* skip */ }
    }
  }

  return {
    content: textParts.join(' '),
    toolName: toolNames.join(' '),
  };
}

export function countSessionMessages(db: Database, sessionId: string): number {
  return (db.query(
    'SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?',
  ).get(sessionId) as { cnt: number }).cnt;
}

export function countMessagesBefore(db: Database, sessionId: string, timestamp: number): number {
  return (db.query(
    'SELECT COUNT(*) as cnt FROM messages WHERE session_id = ? AND created_at < ?',
  ).get(sessionId, timestamp) as { cnt: number }).cnt;
}

export function countMessagesAfter(db: Database, sessionId: string, timestamp: number): number {
  return (db.query(
    'SELECT COUNT(*) as cnt FROM messages WHERE session_id = ? AND created_at > ?',
  ).get(sessionId, timestamp) as { cnt: number }).cnt;
}

export function getLatestMessage(db: Database, sessionId: string): SessionSearchMessageRef | null {
  const row = db.query(
    'SELECT id, created_at FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
  ).get(sessionId) as { id: string; created_at: number } | undefined;
  return row ? { id: row.id, timestamp: row.created_at } : null;
}

export function getMessage(
  db: Database,
  messageId: string,
  sessionId: string,
): SessionSearchMessageRef | null {
  const row = db.query(
    'SELECT id, created_at FROM messages WHERE id = ? AND session_id = ?',
  ).get(messageId, sessionId) as { id: string; created_at: number } | undefined;
  return row ? { id: row.id, timestamp: row.created_at } : null;
}

export function listMessagesBefore(
  db: Database,
  sessionId: string,
  timestamp: number,
  limit: number,
): SessionSearchMessageListItem[] {
  const rows = db.query(
    'SELECT id, role, created_at FROM messages WHERE session_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?',
  ).all(sessionId, timestamp, limit) as Array<{ id: string; role: string; created_at: number }>;
  return rows.map((row) => ({ id: row.id, role: row.role, timestamp: row.created_at }));
}

export function listMessagesAfter(
  db: Database,
  sessionId: string,
  timestamp: number,
  limit: number,
): SessionSearchMessageListItem[] {
  const rows = db.query(
    'SELECT id, role, created_at FROM messages WHERE session_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?',
  ).all(sessionId, timestamp, limit) as Array<{ id: string; role: string; created_at: number }>;
  return rows.map((row) => ({ id: row.id, role: row.role, timestamp: row.created_at }));
}

export function getMessageSummary(
  db: Database,
  messageId: string,
): SessionSearchMessageSummary | null {
  const row = db.query(
    'SELECT role, created_at FROM messages WHERE id = ?',
  ).get(messageId) as { role: string; created_at: number } | undefined;
  if (!row) return null;
  const { content, toolName } = getMessageContentForFts(db, messageId);
  return { role: row.role, timestamp: row.created_at, content, toolName };
}

/** SQLite implementation of the session-search query port. The accessor is
 * injected by the composition root (bootstrap) or the compat module; query
 * SQL, ordering, sanitization, fallback, snippet bounds, and return shapes
 * are unchanged from pre-S5. */
export function createSessionSearchQueryRepository(
  getDb: SessionSearchDatabaseAccessor,
): SessionSearchQueryPort {
  return {
    searchMessages: (options) => searchMessages(getDb(), options),
    countSessionMessages: (sessionId) => countSessionMessages(getDb(), sessionId),
    countMessagesBefore: (sessionId, timestamp) => countMessagesBefore(getDb(), sessionId, timestamp),
    countMessagesAfter: (sessionId, timestamp) => countMessagesAfter(getDb(), sessionId, timestamp),
    getLatestMessage: (sessionId) => getLatestMessage(getDb(), sessionId),
    getMessage: (messageId, sessionId) => getMessage(getDb(), messageId, sessionId),
    listMessagesBefore: (sessionId, timestamp, limit) => listMessagesBefore(getDb(), sessionId, timestamp, limit),
    listMessagesAfter: (sessionId, timestamp, limit) => listMessagesAfter(getDb(), sessionId, timestamp, limit),
    getMessageSummary: (messageId) => getMessageSummary(getDb(), messageId),
  };
}
