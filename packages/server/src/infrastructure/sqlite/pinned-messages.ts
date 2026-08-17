import { getDatabase } from './database';
import type { PinnedMessage } from '@jean2/sdk';
import { HttpError } from '@/application/http-errors';

// =============================================================================
// Error Types
// =============================================================================

export type PinnedMessageErrorCode =
  | 'workspace_not_found'
  | 'session_not_found'
  | 'message_not_found'
  | 'message_not_assistant'
  | 'message_session_mismatch'
  | 'session_workspace_mismatch';

export class PinnedMessageError extends HttpError {
  constructor(
    message: string,
    public code: PinnedMessageErrorCode,
  ) {
    const status = code === 'message_not_assistant' ? 422 : code.endsWith('_not_found') ? 404 : 400;
    super(status, message, code);
  }
}

// =============================================================================
// Preview Helper
// =============================================================================

function createPreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Assistant message';
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

// =============================================================================
// Row Types
// =============================================================================

interface PinnedMessageRow {
  id: string;
  workspace_id: string;
  session_id: string;
  message_id: string;
  created_at: number;
}

interface PinnedMessageWithDetailsRow extends PinnedMessageRow {
  session_title: string | null;
  message_created_at: number;
}

function extractPreviewText(data: string): string {
  try {
    const parsed = JSON.parse(data);
    return parsed.text ?? '';
  } catch {
    return '';
  }
}

function getTextPartsPreview(db: ReturnType<typeof getDatabase>, messageId: string): string {
  const textParts = db
    .query(`SELECT data FROM parts WHERE message_id = ? AND type = 'text' ORDER BY created_at ASC`)
    .all(messageId) as { data: string }[];
  return textParts.map(p => extractPreviewText(p.data)).join(' ');
}

function buildPinnedMessage(
  row: PinnedMessageWithDetailsRow,
  fullText: string,
): PinnedMessage {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    messageId: row.message_id,
    createdAt: row.created_at,
    sessionTitle: row.session_title,
    messageCreatedAt: row.message_created_at,
    preview: createPreview(fullText),
  };
}

export function listPinnedMessagesByWorkspace(workspaceId: string): PinnedMessage[] {
  const db = getDatabase();

  const rows = db
    .query(
      `
      SELECT
        pm.id,
        pm.workspace_id,
        pm.session_id,
        pm.message_id,
        pm.created_at,
        s.title AS session_title,
        m.created_at AS message_created_at
      FROM pinned_messages pm
      JOIN sessions s ON s.id = pm.session_id
      JOIN messages m ON m.id = pm.message_id
      WHERE pm.workspace_id = ?
      ORDER BY pm.created_at DESC
      `,
    )
    .all(workspaceId) as PinnedMessageWithDetailsRow[];

  if (rows.length === 0) return [];

  const messageIds = [...new Set(rows.map(r => r.message_id))];
  const placeholders = messageIds.map(() => '?').join(',');
  const textPartRows = db
    .query(
      `SELECT message_id, data FROM parts WHERE type = 'text' AND message_id IN (${placeholders}) ORDER BY created_at ASC`,
    )
    .all(...messageIds) as { message_id: string; data: string }[];

  const textMap = new Map<string, string[]>();
  for (const row of textPartRows) {
    let texts = textMap.get(row.message_id);
    if (!texts) {
      texts = [];
      textMap.set(row.message_id, texts);
    }
    texts.push(extractPreviewText(row.data));
  }

  return rows.map(row => {
    const fullText = (textMap.get(row.message_id) ?? []).join(' ');
    return buildPinnedMessage(row, fullText);
  });
}

export function pinMessage(input: {
  id?: string;
  workspaceId: string;
  sessionId: string;
  messageId: string;
}): PinnedMessage {
  const db = getDatabase();
  const { workspaceId, sessionId, messageId } = input;

  // Validate workspace exists
  const workspace = db
    .query('SELECT id FROM workspaces WHERE id = ?')
    .get(workspaceId);
  if (!workspace) {
    throw new PinnedMessageError('Workspace not found', 'workspace_not_found');
  }

  // Validate session exists
  const session = db
    .query('SELECT id, workspace_id, title FROM sessions WHERE id = ?')
    .get(sessionId) as { id: string; workspace_id: string; title: string | null } | undefined;
  if (!session) {
    throw new PinnedMessageError('Session not found', 'session_not_found');
  }

  // Validate session belongs to workspace
  if (session.workspace_id !== workspaceId) {
    throw new PinnedMessageError(
      'Session does not belong to this workspace',
      'session_workspace_mismatch',
    );
  }

  // Validate message exists
  const message = db
    .query('SELECT id, session_id, role, created_at FROM messages WHERE id = ?')
    .get(messageId) as { id: string; session_id: string; role: string; created_at: number } | undefined;
  if (!message) {
    throw new PinnedMessageError('Message not found', 'message_not_found');
  }

  // Validate message belongs to session
  if (message.session_id !== sessionId) {
    throw new PinnedMessageError(
      'Message does not belong to this session',
      'message_session_mismatch',
    );
  }

  // Validate message is assistant
  if (message.role !== 'assistant') {
    throw new PinnedMessageError(
      'Only assistant messages can be pinned',
      'message_not_assistant',
    );
  }

  // Check for existing pin (idempotent)
  const existing = db
    .query('SELECT id, created_at FROM pinned_messages WHERE workspace_id = ? AND message_id = ?')
    .get(workspaceId, messageId) as { id: string; created_at: number } | undefined;

  if (existing) {
    const fullText = getTextPartsPreview(db, messageId);
    return {
      id: existing.id,
      workspaceId,
      sessionId,
      messageId,
      createdAt: existing.created_at,
      sessionTitle: session.title,
      messageCreatedAt: message.created_at,
      preview: createPreview(fullText),
    };
  }

  // Insert new pin
  const id = input.id ?? crypto.randomUUID();
  const createdAt = Date.now();

  db.run(
    'INSERT INTO pinned_messages (id, workspace_id, session_id, message_id, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, workspaceId, sessionId, messageId, createdAt],
  );

  const fullText = getTextPartsPreview(db, messageId);

  return {
    id,
    workspaceId,
    sessionId,
    messageId,
    createdAt,
    sessionTitle: session.title,
    messageCreatedAt: message.created_at,
    preview: createPreview(fullText),
  };
}

export function unpinMessage(workspaceId: string, messageId: string): boolean {
  const db = getDatabase();
  const result = db.run(
    'DELETE FROM pinned_messages WHERE workspace_id = ? AND message_id = ?',
    [workspaceId, messageId],
  );
  return result.changes > 0;
}

export function isMessagePinned(workspaceId: string, messageId: string): boolean {
  const db = getDatabase();
  const row = db
    .query('SELECT id FROM pinned_messages WHERE workspace_id = ? AND message_id = ?')
    .get(workspaceId, messageId);
  return row !== null;
}
