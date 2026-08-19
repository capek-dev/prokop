import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Message, MessageWithParts, Part, Session, ToolPart } from '@capekai/types';
import type {
  ClosableStore,
  ConversationStore,
  SessionUpdates,
  StreamingPartSnapshot,
  TranscriptPageResult,
} from './contracts';

interface MessageRow {
  id: string;
  session_id: string;
  sequence: number;
  created_at: number;
  record: string;
}

export type SqliteConversationStore = ConversationStore & ClosableStore;

function parse<T>(value: string): T {
  return JSON.parse(value) as T;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createSqliteConversationStore(options: { path: string }): SqliteConversationStore {
  mkdirSync(dirname(options.path), { recursive: true });
  const db = new Database(options.path, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL');
  // WAL pairing: process-crash-safe commits; OS-loss tail accepted (agent
  // transcripts, not ledgers). Single-writer invariant: only this process writes.
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS capek_sessions (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      created_at TEXT NOT NULL,
      record TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS capek_sessions_parent_created
      ON capek_sessions(parent_id, created_at, id);
    CREATE TABLE IF NOT EXISTS capek_session_sequences (
      session_id TEXT PRIMARY KEY,
      next_sequence INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES capek_sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS capek_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      record TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES capek_sessions(id) ON DELETE CASCADE,
      UNIQUE (session_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS capek_messages_session_sequence
      ON capek_messages(session_id, sequence);
    CREATE TABLE IF NOT EXISTS capek_parts (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      call_id TEXT,
      created_at INTEGER NOT NULL,
      record TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES capek_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES capek_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS capek_parts_message_order
      ON capek_parts(message_id, created_at, id);
    CREATE INDEX IF NOT EXISTS capek_parts_session_order
      ON capek_parts(session_id, created_at, id);
    CREATE INDEX IF NOT EXISTS capek_parts_tool_call
      ON capek_parts(session_id, call_id, created_at, id)
      WHERE type = 'tool' AND call_id IS NOT NULL;
  `);

  const getPartsByMessage = (messageId: string): Part[] => db.query(
    'SELECT record FROM capek_parts WHERE message_id = ? ORDER BY created_at ASC, rowid ASC',
  ).all(messageId).map(row => parse<Part>((row as { record: string }).record));

  const listRows = (sessionId: string): MessageRow[] => db.query(
    'SELECT * FROM capek_messages WHERE session_id = ? ORDER BY sequence ASC, created_at ASC, id ASC',
  ).all(sessionId) as MessageRow[];

  const withParts = (rows: MessageRow[]): MessageWithParts[] => rows.map(row => ({
    message: parse<Message>(row.record),
    parts: getPartsByMessage(row.id),
  }));

  let closed = false;
  const store: SqliteConversationStore = {
    async createSession(input) {
      const now = new Date().toISOString();
      const session = clone({
        ...input,
        tags: input.tags ?? [],
        createdAt: input.createdAt || now,
        updatedAt: input.updatedAt || now,
      }) as Session;
      const transaction = db.transaction((value: Session) => {
        db.run(
          'INSERT INTO capek_sessions (id, parent_id, created_at, record) VALUES (?, ?, ?, ?)',
          [value.id, value.parentId ?? null, value.createdAt, JSON.stringify(value)],
        );
        db.run('INSERT INTO capek_session_sequences (session_id, next_sequence) VALUES (?, 1)', [value.id]);
      });
      transaction.immediate(session);
      return clone(session);
    },
    async getSession(id) {
      const row = db.query('SELECT record FROM capek_sessions WHERE id = ?').get(id) as { record: string } | null;
      return row ? parse<Session>(row.record) : null;
    },
    async updateSession(id, updates: SessionUpdates) {
      const current = await store.getSession(id);
      if (!current) return null;
      const updated = { ...current, ...updates, updatedAt: new Date().toISOString() } as Session;
      db.run(
        'UPDATE capek_sessions SET parent_id = ?, record = ? WHERE id = ?',
        [updated.parentId ?? null, JSON.stringify(updated), id],
      );
      return clone(updated);
    },
    async getChildSessions(parentId) {
      return (db.query(
        'SELECT record FROM capek_sessions WHERE parent_id = ? ORDER BY created_at ASC, rowid ASC',
      ).all(parentId) as Array<{ record: string }>).map(row => parse<Session>(row.record));
    },
    async createMessage(message) {
      const transaction = db.transaction((value: Message) => {
        const sequenceRow = db.query(
          'SELECT next_sequence FROM capek_session_sequences WHERE session_id = ?',
        ).get(value.sessionId) as { next_sequence: number } | null;
        if (!sequenceRow) throw new Error(`Session does not exist: ${value.sessionId}`);
        db.run(
          'UPDATE capek_session_sequences SET next_sequence = ? WHERE session_id = ?',
          [sequenceRow.next_sequence + 1, value.sessionId],
        );
        db.run(
          'INSERT INTO capek_messages (id, session_id, sequence, created_at, record) VALUES (?, ?, ?, ?, ?)',
          [value.id, value.sessionId, sequenceRow.next_sequence, value.createdAt, JSON.stringify(value)],
        );
      });
      transaction.immediate(message);
      return clone(message);
    },
    async getMessage(id) {
      const row = db.query('SELECT record FROM capek_messages WHERE id = ?').get(id) as { record: string } | null;
      return row ? parse<Message>(row.record) : null;
    },
    async getMessageWithParts(messageId) {
      const message = await store.getMessage(messageId);
      return message ? { message, parts: getPartsByMessage(messageId) } : null;
    },
    async updateMessage(id, updates) {
      const current = await store.getMessage(id);
      if (!current) return null;
      const updated = { ...current, ...updates } as Message;
      db.run(
        'UPDATE capek_messages SET created_at = ?, record = ? WHERE id = ?',
        [updated.createdAt, JSON.stringify(updated), id],
      );
      return clone(updated);
    },
    async deleteMessage(messageId) {
      return db.run('DELETE FROM capek_messages WHERE id = ?', [messageId]).changes > 0;
    },
    async listMessagesWithParts(sessionId) {
      return withParts(listRows(sessionId));
    },
    async listLatestMessagesWithPartsPage(sessionId, limit = 50): Promise<TranscriptPageResult> {
      const effectiveLimit = Math.min(Math.max(limit, 1), 100);
      const descending = db.query(
        'SELECT * FROM capek_messages WHERE session_id = ? ORDER BY sequence DESC, created_at DESC, id DESC LIMIT ?',
      ).all(sessionId, effectiveLimit) as MessageRow[];
      const rows = descending.reverse();
      const oldestSequence = rows[0]?.sequence ?? null;
      const hasOlder = oldestSequence === null ? false : Boolean(db.query(
        'SELECT 1 FROM capek_messages WHERE session_id = ? AND sequence < ? LIMIT 1',
      ).get(sessionId, oldestSequence));
      return {
        messages: withParts(rows),
        pagination: {
          hasOlder,
          oldestSequence,
          newestSequence: rows.at(-1)?.sequence ?? null,
          limit: effectiveLimit,
        },
      };
    },
    async buildEffectiveContextHistory(sessionId) {
      const rows = listRows(sessionId);
      let boundary: MessageRow | undefined;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        const message = parse<Message>(rows[index].record);
        if (message.role !== 'assistant' || message.summary !== true || message.mode !== 'compaction' || !message.parentId) continue;
        const trigger = rows.find(row => row.id === message.parentId);
        if (!trigger) continue;
        if (!getPartsByMessage(trigger.id).some(part => part.type === 'compaction')) continue;
        boundary = trigger;
        break;
      }
      const effectiveRows = boundary ? rows.filter(row => row.sequence >= boundary.sequence) : rows;
      return {
        messages: withParts(effectiveRows),
        latestCompactionBoundary: boundary?.id ?? null,
        hasCompaction: Boolean(boundary),
      };
    },
    async createPart(part, sessionId) {
      const message = db.query(
        'SELECT session_id FROM capek_messages WHERE id = ?',
      ).get(part.messageId) as { session_id: string } | null;
      if (!message || message.session_id !== sessionId) {
        throw new Error(`Message does not exist in session: ${part.messageId}`);
      }
      db.run(
        `INSERT INTO capek_parts (id, message_id, session_id, type, call_id, created_at, record)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [part.id, part.messageId, sessionId, part.type, part.type === 'tool' ? part.callId : null, part.createdAt, JSON.stringify(part)],
      );
      return clone(part);
    },
    async getPart(id) {
      const row = db.query('SELECT record FROM capek_parts WHERE id = ?').get(id) as { record: string } | null;
      return row ? parse<Part>(row.record) : null;
    },
    async getPartsByMessage(messageId) {
      return getPartsByMessage(messageId);
    },
    async getPartsBySession(sessionId) {
      return (db.query(
        'SELECT record FROM capek_parts WHERE session_id = ? ORDER BY created_at ASC, rowid ASC',
      ).all(sessionId) as Array<{ record: string }>).map(row => parse<Part>(row.record));
    },
    async updatePart(id, updates) {
      const current = await store.getPart(id);
      if (!current) return null;
      const updated = { ...current, ...updates } as Part;
      db.run(
        'UPDATE capek_parts SET type = ?, call_id = ?, created_at = ?, record = ? WHERE id = ?',
        [
          updated.type,
          updated.type === 'tool' ? updated.callId : null,
          updated.createdAt,
          JSON.stringify(updated),
          id,
        ],
      );
      return clone(updated);
    },
    async persistStreamingPartSnapshots(snapshots: StreamingPartSnapshot[]) {
      const transaction = db.transaction((values: StreamingPartSnapshot[]) => {
        const select = db.prepare(
          'SELECT record FROM capek_parts WHERE id = ? AND message_id = ? AND session_id = ? AND type = ?',
        );
        const update = db.prepare('UPDATE capek_parts SET record = ? WHERE id = ?');
        let count = 0;
        for (const snapshot of values) {
          const row = select.get(snapshot.id, snapshot.messageId, snapshot.sessionId, snapshot.type) as { record: string } | null;
          if (!row) continue;
          const part = { ...parse<Part>(row.record), text: snapshot.text } as Part;
          update.run(JSON.stringify(part), snapshot.id);
          count += 1;
        }
        return count;
      });
      return transaction.immediate(snapshots);
    },
    async transitionToolToRunningByCallId(sessionId, callId, childSessionId) {
      const rows = db.query(
        `SELECT record FROM capek_parts
         WHERE session_id = ? AND call_id = ? AND type = 'tool'
         ORDER BY created_at DESC, rowid DESC`,
      ).all(sessionId, callId) as Array<{ record: string }>;
      const toolPart = rows.map(row => parse<ToolPart>(row.record))
        .find(part => part.state.status === 'pending');
      if (!toolPart) return null;
      return await store.updatePart(toolPart.id, {
        state: {
          status: 'running',
          input: toolPart.state.input,
          startedAt: Date.now(),
          ...(childSessionId ? { childSessionId } : {}),
        },
      }) as ToolPart;
    },
    async transitionToolToInterrupted(partId, reason) {
      const current = await store.getPart(partId);
      if (!current || current.type !== 'tool') return null;
      const now = Date.now();
      return await store.updatePart(partId, {
        state: {
          status: 'interrupted',
          input: current.state.input,
          startedAt: current.state.status === 'running' ? current.state.startedAt : now,
          interruptedAt: now,
          reason,
          ...('childSessionId' in current.state && current.state.childSessionId
            ? { childSessionId: current.state.childSessionId }
            : {}),
        },
      }) as ToolPart;
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };

  return store;
}
