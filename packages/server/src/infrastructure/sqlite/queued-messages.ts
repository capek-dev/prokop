import { getDatabase } from './database';
import { getAttachment } from './attachments';
import type { QueuedMessage } from '@prokopai/sdk';

interface QueuedMessageRow {
  id: string;
  session_id: string;
  content: string;
  position: number;
  created_at: number;
  attachments: string | null;
}

function rowToQueuedMessage(row: QueuedMessageRow): QueuedMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    position: row.position,
    createdAt: row.created_at,
    ...(row.attachments ? { attachments: JSON.parse(row.attachments) } : {}),
  };
}

function queuedMessageToRow(msg: QueuedMessage): QueuedMessageRow {
  return {
    id: msg.id,
    session_id: msg.sessionId,
    content: msg.content,
    position: msg.position,
    created_at: msg.createdAt,
    attachments: msg.attachments ? JSON.stringify(msg.attachments) : null,
  };
}

export function createQueuedMessage(msg: QueuedMessage): QueuedMessage {
  const db = getDatabase();
  const row = queuedMessageToRow(msg);

  db.run(
    `INSERT INTO queued_messages (id, session_id, content, position, created_at, attachments)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [row.id, row.session_id, row.content, row.position, row.created_at, row.attachments],
  );

  return msg;
}

export function getQueuedMessage(id: string): QueuedMessage | null {
  const db = getDatabase();
  const row = db
    .query('SELECT * FROM queued_messages WHERE id = ?')
    .get(id) as QueuedMessageRow | undefined;

  return row ? rowToQueuedMessage(row) : null;
}

export function listQueuedMessages(sessionId: string): QueuedMessage[] {
  const db = getDatabase();
  const rows = db
    .query(
      'SELECT * FROM queued_messages WHERE session_id = ? ORDER BY position ASC',
    )
    .all(sessionId) as QueuedMessageRow[];

  return rows.map(rowToQueuedMessage);
}

export function deleteQueuedMessage(id: string): boolean {
  const db = getDatabase();
  const result = db.run('DELETE FROM queued_messages WHERE id = ?', [id]);
  return result.changes > 0;
}

export function deleteQueuedMessagesBySession(sessionId: string): number {
  const db = getDatabase();
  const result = db.run(
    'DELETE FROM queued_messages WHERE session_id = ?',
    [sessionId],
  );
  return result.changes;
}

export function getNextQueuedMessage(
  sessionId: string,
): QueuedMessage | null {
  const db = getDatabase();
  const row = db
    .query(
      'SELECT * FROM queued_messages WHERE session_id = ? ORDER BY position ASC LIMIT 1',
    )
    .get(sessionId) as QueuedMessageRow | undefined;

  return row ? rowToQueuedMessage(row) : null;
}

export function getQueuedMessageCount(sessionId: string): number {
  const db = getDatabase();
  const row = db
    .query('SELECT COUNT(*) as count FROM queued_messages WHERE session_id = ?')
    .get(sessionId) as { count: number } | undefined;

  return row?.count ?? 0;
}

export function addMessageToQueue(
  sessionId: string,
  content: string,
  attachments?: Array<{ id: string; kind: string }>,
): QueuedMessage {
  const db = getDatabase();

  const row = db
    .query('SELECT MAX(position) as max_pos FROM queued_messages WHERE session_id = ?')
    .get(sessionId) as { max_pos: number | null } | undefined;

  const nextPosition = (row?.max_pos ?? -1) + 1;

  const enrichedAttachments = attachments?.map(att => {
    const record = getAttachment(sessionId, att.id);
    if (!record) return att;
    return {
      id: att.id,
      kind: att.kind,
      filename: record.filename,
      mimeType: record.mimeType,
      accessKey: record.accessKey,
    };
  });

  const msg: QueuedMessage = {
    id: crypto.randomUUID(),
    sessionId,
    content,
    attachments: enrichedAttachments,
    position: nextPosition,
    createdAt: Date.now(),
  };

  return createQueuedMessage(msg);
}
