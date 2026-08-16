/**
 * S5 message repository: SQL and row mapping for the messages and parts
 * tables over an injected database accessor. The FTS projection calls the
 * current implementation interleaves with CRUD arrive through the
 * temporary hooks in the exact pre-slice order; S6 owns moving the
 * projection behind committed events, at which point those hooks retire.
 */

import type { Database } from 'bun:sqlite';
import type {
  AssistantMessage,
  Message,
  MessageWithParts,
  Part,
  SystemMessage,
  ToolPart,
  UserMessage,
} from '@jean2/sdk';
import type {
  CompactionBoundary,
  MessageStorePort,
  SessionMessageRepositoryHooks,
  StreamingPartSnapshot,
  ToolInterruptReason,
  TranscriptPageResult,
} from '@/application/ports/session-message';

export type MessageDatabaseAccessor = () => Database;

interface MessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  created_at: number;
  status: 'streaming' | 'completed' | 'error' | 'interrupted' | null;
  model_id: string | null;
  provider_id: string | null;
  agent: string | null;
  tokens_prompt: number;
  tokens_completion: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  tokens_no_cache: number;
  cost: number;
  completed_at: number | null;
  error: string | null;
  summary: number;
  mode: string | null;
  parent_id: string | null;
  structured_output: string | null;
  sequence: number | null;
}

interface PartRow {
  id: string;
  message_id: string;
  session_id: string;
  type: string;
  call_id: string | null;
  data: string;
  created_at: number;
}

interface JoinedMessagePartRow extends MessageRow {
  part_id: string | null;
  part_message_id: string | null;
  part_session_id: string | null;
  part_type: string | null;
  part_call_id: string | null;
  part_data: string | null;
  part_created_at: number | null;
}

function rowToMessage(row: MessageRow): Message {
  const base = {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    createdAt: row.created_at,
  };

  if (row.role === 'assistant') {
    return {
      ...base,
      role: 'assistant' as const,
      status: row.status as 'streaming' | 'completed' | 'error' | 'interrupted',
      modelId: row.model_id!,
      providerId: row.provider_id!,
      agent: row.agent ?? undefined,
      tokens: {
        prompt: row.tokens_prompt,
        completion: row.tokens_completion,
        cacheRead: row.tokens_cache_read,
        cacheWrite: row.tokens_cache_write,
        noCache: row.tokens_no_cache,
      },
      cost: row.cost,
      completedAt: row.completed_at ?? undefined,
      error: row.error ?? undefined,
      summary: row.summary ? true : undefined,
      mode: (row.mode as 'chat' | 'compaction' | 'compact_failed' | undefined) ?? undefined,
      parentId: row.parent_id ?? undefined,
      structuredOutput: row.structured_output ? JSON.parse(row.structured_output) : undefined,
    } as AssistantMessage;
  }

  return base as UserMessage | SystemMessage;
}

function messageToRow(message: Message, sequence?: number): MessageRow {
  const base: MessageRow = {
    id: message.id,
    session_id: message.sessionId,
    role: message.role,
    created_at: message.createdAt,
    status: null,
    model_id: null,
    provider_id: null,
    agent: null,
    tokens_prompt: 0,
    tokens_completion: 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    tokens_no_cache: 0,
    cost: 0,
    completed_at: null,
    error: null,
    summary: 0,
    mode: null,
    parent_id: null,
    structured_output: null,
    sequence: sequence ?? null,
  };

  if (message.role === 'assistant') {
    return {
      ...base,
      status: message.status,
      model_id: message.modelId,
      provider_id: message.providerId,
      agent: message.agent ?? null,
      tokens_prompt: message.tokens.prompt,
      tokens_completion: message.tokens.completion,
      tokens_cache_read: message.tokens.cacheRead ?? 0,
      tokens_cache_write: message.tokens.cacheWrite ?? 0,
      tokens_no_cache: message.tokens.noCache ?? 0,
      cost: message.cost,
      completed_at: message.completedAt ?? null,
      error: message.error ?? null,
      summary: message.summary ? 1 : 0,
      mode: message.mode ?? null,
      parent_id: message.parentId ?? null,
      structured_output: message.structuredOutput ? JSON.stringify(message.structuredOutput) : null,
    };
  }

  return base;
}

function rowToPart(row: PartRow): Part {
  const data = JSON.parse(row.data);
  return {
    id: row.id,
    messageId: row.message_id,
    createdAt: row.created_at,
    type: row.type,
    ...data,
  } as Part;
}

function partToRow(part: Part, sessionId: string): PartRow {
  const { id, messageId, createdAt, ...data } = part;
  return {
    id,
    message_id: messageId,
    session_id: sessionId,
    type: part.type,
    call_id: part.type === 'tool' ? (part as ToolPart).callId : null,
    data: JSON.stringify(data),
    created_at: createdAt,
  };
}

function groupJoinedRows(rows: JoinedMessagePartRow[]): MessageWithParts[] {
  const byMessage = new Map<string, MessageWithParts>();
  for (const row of rows) {
    let entry = byMessage.get(row.id);
    if (!entry) {
      entry = { message: rowToMessage(row), parts: [] };
      byMessage.set(row.id, entry);
    }
    if (row.part_id) {
      const partRow: PartRow = {
        id: row.part_id,
        message_id: row.part_message_id!,
        session_id: row.part_session_id!,
        type: row.part_type!,
        call_id: row.part_call_id,
        data: row.part_data!,
        created_at: row.part_created_at!,
      };
      entry.parts.push(rowToPart(partRow));
    }
  }
  return [...byMessage.values()];
}

const DEFAULT_TRANSCRIPT_LIMIT = 50;
const MAX_TRANSCRIPT_LIMIT = 100;

export function createMessageRepository(
  getDb: MessageDatabaseAccessor,
  hooks: SessionMessageRepositoryHooks,
): MessageStorePort {
  function createMessage(message: Message): Message {
    const db = getDb();

    // Allocate the next sequence atomically per session.
    // Uses a subquery to find the current max sequence for this session.
    const result = db.query(
      'SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq FROM messages WHERE session_id = ?',
    ).get(message.sessionId) as { next_seq: number };
    const sequence = result.next_seq;

    const row = messageToRow(message, sequence);

    db.run(
      `
      INSERT INTO messages (
        id, session_id, sequence, role, created_at, status, model_id, provider_id,
        agent, tokens_prompt, tokens_completion, tokens_cache_read, tokens_cache_write,
        tokens_no_cache, cost, completed_at, error, summary, mode, parent_id, structured_output
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        row.id,
        row.session_id,
        row.sequence,
        row.role,
        row.created_at,
        row.status,
        row.model_id,
        row.provider_id,
        row.agent,
        row.tokens_prompt,
        row.tokens_completion,
        row.tokens_cache_read,
        row.tokens_cache_write,
        row.tokens_no_cache,
        row.cost,
        row.completed_at,
        row.error,
        row.summary,
        row.mode,
        row.parent_id,
        row.structured_output,
      ],
    );

    // Do not sync FTS on message creation. The message has no parts yet.
    // FTS is synced when parts are created (user text) or at assistant finalization.

    return message;
  }

  function getMessage(id: string): Message | null {
    const db = getDb();
    const row = db
      .query('SELECT * FROM messages WHERE id = ?')
      .get(id) as MessageRow | undefined;
    return row ? rowToMessage(row) : null;
  }

  function updateMessage(
    id: string,
    updates: Partial<Message>,
    options?: { syncFts?: boolean },
  ): Message | null {
    const db = getDb();
    const existing = getMessage(id);
    if (!existing) return null;

    const updated: Message = { ...existing, ...updates } as Message;
    const row = messageToRow(updated);

    db.run(
      `
      UPDATE messages SET
        status = ?, model_id = ?, provider_id = ?, agent = ?,
        tokens_prompt = ?, tokens_completion = ?, tokens_cache_read = ?,
        tokens_cache_write = ?, tokens_no_cache = ?, cost = ?, completed_at = ?, error = ?,
        summary = ?, mode = ?, parent_id = ?, structured_output = ?
      WHERE id = ?
    `,
      [
        row.status,
        row.model_id,
        row.provider_id,
        row.agent,
        row.tokens_prompt,
        row.tokens_completion,
        row.tokens_cache_read,
        row.tokens_cache_write,
        row.tokens_no_cache,
        row.cost,
        row.completed_at,
        row.error,
        row.summary,
        row.mode,
        row.parent_id,
        row.structured_output,
        id,
      ],
    );

    if (options?.syncFts !== false) {
      hooks.events.publish({ type: 'message.changed', messageId: id });
    }

    return updated;
  }

  function listMessages(sessionId: string): Message[] {
    const db = getDb();
    const rows = db
      .query(
        `SELECT * FROM messages
         WHERE session_id = ?
         ORDER BY sequence IS NULL, sequence ASC, created_at ASC, rowid ASC`,
      )
      .all(sessionId) as MessageRow[];
    return rows.map(rowToMessage);
  }

  function deleteMessages(sessionId: string): number {
    const db = getDb();
    const result = db.run('DELETE FROM messages WHERE session_id = ?', [
      sessionId,
    ]);
    hooks.events.publish({ type: 'session.deleted', sessionId });
    return result.changes;
  }

  function deleteMessage(messageId: string): boolean {
    const db = getDb();
    db.run('DELETE FROM parts WHERE message_id = ?', [messageId]);
    const result = db.run('DELETE FROM messages WHERE id = ?', [messageId]);
    const deleted = result.changes > 0;
    if (deleted) hooks.events.publish({ type: 'message.deleted', messageId });
    return deleted;
  }

  function createPart(
    part: Part,
    sessionId: string,
    options?: { syncFts?: boolean },
  ): Part {
    const db = getDb();
    const row = partToRow(part, sessionId);

    db.run(
      `
      INSERT INTO parts (id, message_id, session_id, type, call_id, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      [row.id, row.message_id, row.session_id, row.type, row.call_id, row.data, row.created_at],
    );

    if (options?.syncFts !== false && (part.type === 'text' || part.type === 'tool')) {
      hooks.events.publish({ type: 'message.changed', messageId: part.messageId });
    }

    return part;
  }

  function getPart(id: string): Part | null {
    const db = getDb();
    const row = db
      .query('SELECT * FROM parts WHERE id = ?')
      .get(id) as PartRow | undefined;
    return row ? rowToPart(row) : null;
  }

  function updatePart(
    id: string,
    updates: Record<string, unknown>,
    options?: { syncFts?: boolean },
  ): Part | null {
    const db = getDb();
    const existing = getPart(id);
    if (!existing) return null;

    const updated = { ...existing, ...updates } as Part;

    const message = getMessage(existing.messageId);
    if (!message) return null;

    const row = partToRow(updated, message.sessionId);

    db.run(`UPDATE parts SET type = ?, call_id = ?, data = ? WHERE id = ?`, [
      row.type,
      row.call_id,
      row.data,
      id,
    ]);

    if (
      options?.syncFts !== false &&
      (existing.type === 'text' || existing.type === 'tool' || updated.type === 'text' || updated.type === 'tool')
    ) {
      hooks.events.publish({ type: 'message.changed', messageId: message.id });
    }

    return updated;
  }

  function getPartsByMessage(messageId: string): Part[] {
    const db = getDb();
    const rows = db
      .query('SELECT * FROM parts WHERE message_id = ? ORDER BY created_at ASC')
      .all(messageId) as PartRow[];
    return rows.map(rowToPart);
  }

  function getPartsBySession(sessionId: string): Part[] {
    const db = getDb();
    const rows = db
      .query('SELECT * FROM parts WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as PartRow[];
    return rows.map(rowToPart);
  }

  function getMessageWithParts(
    messageId: string,
  ): MessageWithParts | null {
    const message = getMessage(messageId);
    if (!message) return null;

    const parts = getPartsByMessage(messageId);
    return { message, parts };
  }

  function listMessagesWithParts(sessionId: string): MessageWithParts[] {
    const db = getDb();
    const rows = db
      .query(
        `SELECT m.*, p.id AS part_id, p.message_id AS part_message_id,
                p.session_id AS part_session_id, p.type AS part_type,
                p.call_id AS part_call_id, p.data AS part_data, p.created_at AS part_created_at
         FROM messages m
         LEFT JOIN parts p ON p.message_id = m.id
         WHERE m.session_id = ?
         ORDER BY m.sequence IS NULL, m.sequence ASC, m.created_at ASC, m.rowid ASC,
                  p.created_at ASC, p.id ASC`,
      )
      .all(sessionId) as JoinedMessagePartRow[];
    return groupJoinedRows(rows);
  }

  function createToolPartPending(
    messageId: string,
    callId: string,
    toolName: string,
    input: Record<string, unknown>,
    sessionId: string,
  ): ToolPart {
    const part: ToolPart = {
      id: crypto.randomUUID(),
      messageId,
      createdAt: Date.now(),
      type: 'tool',
      callId,
      name: toolName,
      state: {
        status: 'pending',
        input,
      },
    };

    createPart(part, sessionId, { syncFts: false });
    return part;
  }

  function getSessionIdForMessage(messageId: string): string | null {
    const db = getDb();
    const row = db.query('SELECT session_id FROM messages WHERE id = ?').get(messageId) as { session_id: string } | undefined;
    return row?.session_id ?? null;
  }

  /**
   * Persist a fully-constructed part directly without read-before-write.
   */
  function persistKnownPart(
    part: Part,
    options?: { syncFts?: boolean },
  ): Part {
    const db = getDb();
    const sessionId = getSessionIdForMessage(part.messageId);
    if (!sessionId) return part;
    const row = partToRow(part, sessionId);

    db.run(
      `UPDATE parts SET type = ?, call_id = ?, data = ? WHERE id = ? AND message_id = ? AND session_id = ?`,
      [row.type, row.call_id, row.data, row.id, row.message_id, row.session_id],
    );

    if (options?.syncFts !== false && (part.type === 'text' || part.type === 'tool')) {
      hooks.events.publish({ type: 'message.changed', messageId: part.messageId });
    }

    return part;
  }

  function transitionToolToRunning(
    partId: string,
    childSessionId?: string,
  ): ToolPart | null {
    const existing = getPart(partId);
    if (!existing || existing.type !== 'tool') return null;

    const toolPart = existing as ToolPart;
    if (toolPart.state.status !== 'pending') return null;

    const updated: ToolPart = {
      ...toolPart,
      state: {
        status: 'running',
        input: toolPart.state.input,
        startedAt: Date.now(),
        ...(childSessionId && { childSessionId }),
      },
    };

    return persistKnownPart(updated, { syncFts: false }) as ToolPart;
  }

  function transitionToolToCompleted(
    partId: string,
    output: unknown,
  ): ToolPart | null {
    const existing = getPart(partId);
    if (!existing || existing.type !== 'tool') return null;

    const toolPart = existing as ToolPart;
    if (toolPart.state.status !== 'running') return null;

    const now = Date.now();
    const updated: ToolPart = {
      ...toolPart,
      state: {
        status: 'completed',
        input: toolPart.state.input,
        output,
        startedAt: toolPart.state.startedAt,
        completedAt: now,
        ...(toolPart.state.childSessionId && { childSessionId: toolPart.state.childSessionId }),
      },
    };

    return persistKnownPart(updated, { syncFts: false }) as ToolPart;
  }

  function transitionToolToError(partId: string, error: string): ToolPart | null {
    const existing = getPart(partId);
    if (!existing || existing.type !== 'tool') return null;

    const toolPart = existing as ToolPart;
    const now = Date.now();

    const updated: ToolPart = {
      ...toolPart,
      state: {
        status: 'error',
        input: toolPart.state.input,
        error,
        startedAt:
          toolPart.state.status === 'running'
            ? toolPart.state.startedAt
            : now,
        failedAt: now,
      },
    };

    return persistKnownPart(updated, { syncFts: false }) as ToolPart;
  }

  /**
   * Phase 4: Find a tool part by call ID using the indexed (session_id, call_id) lookup.
   * When duplicate call IDs exist, prefers a part in 'pending' state, then newest.
   */
  function getToolPartByCallId(
    sessionId: string,
    callId: string,
  ): ToolPart | null {
    const db = getDb();

    // Primary: indexed lookup on (session_id, call_id)
    const rows = db.query(
      `SELECT * FROM parts
       WHERE session_id = ?
         AND call_id = ?
         AND type = 'tool'
       ORDER BY
         CASE WHEN JSON_EXTRACT(data, '$.state.status') = 'pending' THEN 0 ELSE 1 END,
         created_at DESC, rowid DESC`,
    ).all(sessionId, callId) as PartRow[];

    if (rows.length > 0) {
      return rowToPart(rows[0]) as ToolPart;
    }

    // Fallback: scan unmigrated tool rows with JSON extraction
    const fallbackRows = db.query(
      `SELECT * FROM parts
       WHERE session_id = ?
         AND type = 'tool'
         AND call_id IS NULL
         AND JSON_EXTRACT(data, '$.callId') = ?
       ORDER BY
         CASE WHEN JSON_EXTRACT(data, '$.state.status') = 'pending' THEN 0 ELSE 1 END,
         created_at DESC, rowid DESC
       LIMIT 1`,
    ).all(sessionId, callId) as PartRow[];

    if (fallbackRows.length > 0) {
      return rowToPart(fallbackRows[0]) as ToolPart;
    }

    return null;
  }

  function transitionToolToRunningByCallId(
    sessionId: string,
    callId: string,
    childSessionId?: string,
  ): ToolPart | null {
    const toolPart = getToolPartByCallId(sessionId, callId);

    if (!toolPart || toolPart.state.status !== 'pending') return null;

    const updated: ToolPart = {
      ...toolPart,
      state: {
        status: 'running',
        input: toolPart.state.input,
        startedAt: Date.now(),
        ...(childSessionId && { childSessionId }),
      },
    };

    return persistKnownPart(updated, { syncFts: false }) as ToolPart;
  }

  function transitionToolToInterrupted(
    partId: string,
    reason: ToolInterruptReason,
  ): ToolPart | null {
    const existing = getPart(partId);
    if (!existing || existing.type !== 'tool') return null;

    const toolPart = existing as ToolPart;
    const now = Date.now();

    const updated: ToolPart = {
      ...toolPart,
      state: {
        status: 'interrupted',
        input: toolPart.state.input,
        startedAt:
          toolPart.state.status === 'running'
            ? toolPart.state.startedAt
            : now,
        interruptedAt: now,
        reason,
        ...('childSessionId' in toolPart.state && { childSessionId: (toolPart.state as { childSessionId: string }).childSessionId }),
      },
    };

    return persistKnownPart(updated, { syncFts: false }) as ToolPart;
  }

  function findOrphanedToolCalls(sessionId: string): ToolPart[] {
    const allParts = getPartsBySession(sessionId);
    return allParts.filter(
      (p) => p.type === 'tool' && ((p as ToolPart).state.status === 'pending' || (p as ToolPart).state.status === 'running'),
    ) as ToolPart[];
  }

  function reconcileOrphanedToolCalls(sessionId: string): number {
    const orphaned = findOrphanedToolCalls(sessionId);
    for (const toolPart of orphaned) {
      transitionToolToInterrupted(toolPart.id, 'error');
    }
    return orphaned.length;
  }

  function reconcileAllOrphanedToolCalls(): number {
    const db = getDb();
    const orphanedIds = db
      .query(
        `SELECT id FROM parts
         WHERE type = 'tool'
           AND (JSON_EXTRACT(data, '$.state.status') = 'pending'
                OR JSON_EXTRACT(data, '$.state.status') = 'running')`,
      )
      .all() as { id: string }[];

    let totalReconciled = 0;
    for (const { id } of orphanedIds) {
      if (transitionToolToInterrupted(id, 'error')) {
        totalReconciled++;
      }
    }
    if (totalReconciled > 0) {
      console.log(`[tool-recovery] Reconciled ${totalReconciled} orphaned tool call(s)`);
    }
    return totalReconciled;
  }

  /**
   * Find orphaned compaction triggers for a session.
   * An orphaned trigger is a user message that has a 'compaction' part,
   * but NO assistant message exists with parentId pointing to it.
   */
  function findOrphanedCompactionTriggers(sessionId: string): Message[] {
    const db = getDb();

    const rows = db
      .query(
        `
        SELECT m.* FROM messages m
        WHERE m.session_id = ?
          AND m.role = 'user'
          AND EXISTS (
            SELECT 1 FROM parts p
            WHERE p.message_id = m.id AND p.type = 'compaction'
          )
          AND NOT EXISTS (
            SELECT 1 FROM messages outcome
            WHERE outcome.parent_id = m.id
          )
        ORDER BY m.created_at ASC
        `,
      )
      .all(sessionId) as MessageRow[];

    return rows.map(rowToMessage);
  }

  function listMessagesForSession(sessionId: string): MessageWithParts[] {
    return listMessagesWithParts(sessionId);
  }

  /**
   * Find the latest valid compaction boundary for a session.
   */
  function getLatestCompactionBoundary(
    sessionId: string,
  ): CompactionBoundary | null {
    const db = getDb();

    const row = db.query(
      `SELECT
         summary.id AS summary_id,
         summary.sequence AS summary_sequence,
         trigger.id AS trigger_id,
         trigger.sequence AS trigger_sequence
       FROM messages summary
       JOIN messages trigger
         ON trigger.id = summary.parent_id
        AND trigger.session_id = summary.session_id
       WHERE summary.session_id = ?
         AND summary.role = 'assistant'
         AND summary.summary = 1
         AND summary.mode = 'compaction'
         AND summary.parent_id IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM parts trigger_part
           WHERE trigger_part.message_id = trigger.id
             AND trigger_part.type = 'compaction'
         )
       ORDER BY summary.sequence DESC
       LIMIT 1`,
    ).get(sessionId) as {
      summary_id: string;
      summary_sequence: number;
      trigger_id: string;
      trigger_sequence: number;
    } | undefined;

    if (!row) return null;

    return {
      triggerId: row.trigger_id,
      triggerSequence: row.trigger_sequence,
      summaryId: row.summary_id,
      summarySequence: row.summary_sequence,
    };
  }

  /**
   * Load messages (with parts) at or after a given sequence number.
   */
  function listMessagesWithPartsFromSequence(
    sessionId: string,
    sequence: number,
  ): MessageWithParts[] {
    const db = getDb();
    const rows = db
      .query(
        `SELECT m.*, p.id AS part_id, p.message_id AS part_message_id,
                p.session_id AS part_session_id, p.type AS part_type,
                p.call_id AS part_call_id, p.data AS part_data, p.created_at AS part_created_at
         FROM messages m
         LEFT JOIN parts p ON p.message_id = m.id
         WHERE m.session_id = ?
           AND m.sequence >= ?
         ORDER BY m.sequence ASC, p.created_at ASC, p.id ASC`,
      )
      .all(sessionId, sequence) as JoinedMessagePartRow[];
    return groupJoinedRows(rows);
  }

  /**
   * Build effective context history by reading only the latest valid compaction boundary
   * and the messages that follow it.
   */
  function buildEffectiveContextHistory(
    sessionId: string,
  ): {
    messages: MessageWithParts[];
    latestCompactionBoundary: string | null;
    hasCompaction: boolean;
  } {
    const boundary = getLatestCompactionBoundary(sessionId);

    if (!boundary) {
      return {
        messages: listMessagesWithParts(sessionId),
        latestCompactionBoundary: null,
        hasCompaction: false,
      };
    }

    return {
      messages: listMessagesWithPartsFromSequence(
        sessionId,
        boundary.triggerSequence,
      ),
      latestCompactionBoundary: boundary.triggerId,
      hasCompaction: true,
    };
  }

  /**
   * Select message IDs for the newest page of a session.
   */
  function selectMessageIdsForLatestPage(sessionId: string, limit: number): { id: string; sequence: number | null }[] {
    const db = getDb();
    const effectiveLimit = Math.min(Math.max(limit, 1), MAX_TRANSCRIPT_LIMIT);
    const rows = db.query(
      `SELECT id, sequence FROM messages
       WHERE session_id = ?
       ORDER BY sequence IS NULL, sequence DESC, created_at DESC, rowid DESC
       LIMIT ?`,
    ).all(sessionId, effectiveLimit) as { id: string; sequence: number | null }[];
    return rows.reverse();
  }

  /**
   * Select message IDs for the page before a given sequence.
   */
  function selectMessageIdsBeforeSequence(
    sessionId: string,
    beforeSequence: number,
    limit: number,
  ): { id: string; sequence: number | null }[] {
    const db = getDb();
    const effectiveLimit = Math.min(Math.max(limit, 1), MAX_TRANSCRIPT_LIMIT);
    const rows = db.query(
      `SELECT id, sequence FROM messages
       WHERE session_id = ? AND sequence IS NOT NULL AND sequence < ?
       ORDER BY sequence DESC, created_at DESC, rowid DESC
       LIMIT ?`,
    ).all(sessionId, beforeSequence, effectiveLimit) as { id: string; sequence: number | null }[];
    return rows.reverse();
  }

  /**
   * Fetch messages with parts for a specific set of message IDs.
   */
  function fetchMessagesWithPartsByIds(
    sessionId: string,
    messageIds: string[],
  ): MessageWithParts[] {
    if (messageIds.length === 0) return [];

    const db = getDb();
    const placeholders = messageIds.map(() => '?').join(',');
    const rows = db
      .query(
        `SELECT m.*, p.id AS part_id, p.message_id AS part_message_id,
                p.session_id AS part_session_id, p.type AS part_type,
                p.call_id AS part_call_id, p.data AS part_data, p.created_at AS part_created_at
         FROM messages m
         LEFT JOIN parts p ON p.message_id = m.id
         WHERE m.session_id = ? AND m.id IN (${placeholders})
         ORDER BY m.sequence IS NULL, m.sequence ASC, m.created_at ASC, m.rowid ASC,
                  p.created_at ASC, p.id ASC`,
      )
      .all(sessionId, ...messageIds) as JoinedMessagePartRow[];
    return groupJoinedRows(rows);
  }

  /**
   * Count total messages in a session.
   */
  function countMessagesInSession(sessionId: string): number {
    const db = getDb();
    const row = db.query(
      'SELECT COUNT(*) as count FROM messages WHERE session_id = ?',
    ).get(sessionId) as { count: number };
    return row.count;
  }

  /**
   * Load the newest page of messages with parts for a session.
   */
  function listLatestMessagesWithPartsPage(
    sessionId: string,
    limit: number = DEFAULT_TRANSCRIPT_LIMIT,
  ): TranscriptPageResult {
    const effectiveLimit = Math.min(Math.max(limit, 1), MAX_TRANSCRIPT_LIMIT);
    const idRows = selectMessageIdsForLatestPage(sessionId, effectiveLimit);
    const messageIds = idRows.map((r) => r.id);

    if (messageIds.length === 0) {
      return {
        messages: [],
        pagination: {
          hasOlder: false,
          oldestSequence: null,
          newestSequence: null,
          limit: effectiveLimit,
        },
      };
    }

    const messages = fetchMessagesWithPartsByIds(sessionId, messageIds);

    const oldestSequence = idRows[0]?.sequence ?? null;
    const newestSequence = idRows[idRows.length - 1]?.sequence ?? null;

    const hasOlder = (() => {
      if (!oldestSequence) return false;
      const db = getDb();
      const row = db.query(
        'SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND sequence IS NOT NULL AND sequence < ?',
      ).get(sessionId, oldestSequence) as { count: number };
      return row.count > 0;
    })();

    return {
      messages,
      pagination: {
        hasOlder,
        oldestSequence,
        newestSequence,
        limit: effectiveLimit,
      },
    };
  }

  /**
   * Load a page of messages with parts before a given sequence number.
   */
  function listMessagesWithPartsBeforeSequence(
    sessionId: string,
    beforeSequence: number,
    limit: number = DEFAULT_TRANSCRIPT_LIMIT,
  ): TranscriptPageResult {
    const effectiveLimit = Math.min(Math.max(limit, 1), MAX_TRANSCRIPT_LIMIT);
    const idRows = selectMessageIdsBeforeSequence(sessionId, beforeSequence, effectiveLimit);
    const messageIds = idRows.map((r) => r.id);

    if (messageIds.length === 0) {
      return {
        messages: [],
        pagination: {
          hasOlder: false,
          oldestSequence: null,
          newestSequence: null,
          limit: effectiveLimit,
        },
      };
    }

    const messages = fetchMessagesWithPartsByIds(sessionId, messageIds);

    const oldestSequence = idRows[0]?.sequence ?? null;
    const newestSequence = idRows[idRows.length - 1]?.sequence ?? null;

    const hasOlder = (() => {
      if (!oldestSequence) return false;
      const db = getDb();
      const row = db.query(
        'SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND sequence IS NOT NULL AND sequence < ?',
      ).get(sessionId, oldestSequence) as { count: number };
      return row.count > 0;
    })();

    return {
      messages,
      pagination: {
        hasOlder,
        oldestSequence,
        newestSequence,
        limit: effectiveLimit,
      },
    };
  }

  function syncMessageFts(messageId: string): void {
    hooks.events.publish({ type: 'message.changed', messageId });
  }

  /**
   * Persist a single streaming snapshot directly.
   */
  function persistStreamingPartSnapshot(snapshot: StreamingPartSnapshot): boolean {
    const db = getDb();

    const data = JSON.stringify({ text: snapshot.text });
    const result = db.run(
      `UPDATE parts
       SET data = ?
       WHERE id = ?
         AND message_id = ?
         AND session_id = ?
         AND type = ?`,
      [data, snapshot.id, snapshot.messageId, snapshot.sessionId, snapshot.type],
    );

    return result.changes > 0;
  }

  /**
   * Persist multiple streaming snapshots in one transaction.
   */
  function persistStreamingPartSnapshots(snapshots: StreamingPartSnapshot[]): number {
    if (snapshots.length === 0) return 0;

    const db = getDb();

    return db.transaction(() => {
      const stmt = db.prepare(
        `UPDATE parts
         SET data = ?
         WHERE id = ?
           AND message_id = ?
           AND session_id = ?
           AND type = ?`,
      );

      let count = 0;
      for (const snapshot of snapshots) {
        const data = JSON.stringify({ text: snapshot.text });
        const result = stmt.run(data, snapshot.id, snapshot.messageId, snapshot.sessionId, snapshot.type);
        if (result.changes > 0) count++;
      }
      return count;
    })();
  }

  return {
    createMessage,
    getMessage,
    updateMessage,
    listMessages,
    deleteMessages,
    deleteMessage,
    createPart,
    getPart,
    updatePart,
    getPartsByMessage,
    getPartsBySession,
    getMessageWithParts,
    listMessagesWithParts,
    createToolPartPending,
    transitionToolToRunning,
    transitionToolToCompleted,
    transitionToolToError,
    getToolPartByCallId,
    transitionToolToRunningByCallId,
    transitionToolToInterrupted,
    findOrphanedToolCalls,
    reconcileOrphanedToolCalls,
    reconcileAllOrphanedToolCalls,
    findOrphanedCompactionTriggers,
    listMessagesForSession,
    getLatestCompactionBoundary,
    listMessagesWithPartsFromSequence,
    buildEffectiveContextHistory,
    countMessagesInSession,
    listLatestMessagesWithPartsPage,
    listMessagesWithPartsBeforeSequence,
    syncMessageFts,
    persistStreamingPartSnapshot,
    persistStreamingPartSnapshots,
  };
}
