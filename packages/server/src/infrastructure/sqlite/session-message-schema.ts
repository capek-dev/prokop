/**
 * S5 session/message/part schema and migrations.
 *
 * Moved byte-for-byte from `store/index.ts`: the sessions, messages, and
 * parts DDL, their indexes, the legacy ALTER migrations (structured_output,
 * tags, auto_approve_severity, agent_id, cache-token columns), the
 * parts.call_id backfill, and the messages.sequence backfill. No schema,
 * ordering, or migration behavior changed; this module is the composition
 * root's single call for the session/message/part schema surface.
 */

import type { Database } from 'bun:sqlite';

export interface SessionMessageSchemaOptions {
  /** Passed by the composition root; the infrastructure layer owns no
   * diagnostics policy. */
  perfDiagnosticsEnabled: boolean;
}

export function initializeSessionMessageSchema(
  db: Database,
  options: SessionMessageSchemaOptions,
): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      workspace_root_id TEXT,
      preconfig_id TEXT,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT,
      selected_model TEXT,
      selected_provider TEXT,
      selected_variant TEXT,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      no_cache_tokens INTEGER DEFAULT 0,
      parent_id TEXT,
      agent_name TEXT,
      subagent_status TEXT,
      running_at TEXT,
      compacting INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_root_id) REFERENCES managed_worktrees(id)
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id)');

  try {
    db.run('ALTER TABLE sessions ADD COLUMN workspace_root_id TEXT REFERENCES managed_worktrees(id)');
  } catch {
    // Column already exists
  }
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_workspace_root ON sessions(workspace_root_id)');

  // Phase 5: Workspace-leading indexes for paginated session queries
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_workspace_updated ON sessions(workspace_id, updated_at DESC, id DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_workspace_status_updated ON sessions(workspace_id, status, updated_at DESC, id DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_root_workspace_status_updated ON sessions(workspace_id, status, updated_at DESC, id DESC) WHERE parent_id IS NULL');

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,

      -- Assistant-only fields (NULL for user/system)
      status TEXT,
      model_id TEXT,
      provider_id TEXT,
      agent TEXT,
      tokens_prompt INTEGER DEFAULT 0,
      tokens_completion INTEGER DEFAULT 0,
      tokens_cache_read INTEGER DEFAULT 0,
      tokens_cache_write INTEGER DEFAULT 0,
      tokens_no_cache INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      completed_at INTEGER,
      error TEXT,

      -- Compaction metadata (on assistant messages)
      summary INTEGER DEFAULT 0,
      mode TEXT,
      parent_id TEXT,

      -- Structured output (when response format was used)
      structured_output TEXT,

      -- Deterministic per-session ordering (Phase 1)
      sequence INTEGER,

      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at)');
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_session_status ON messages(session_id, status) WHERE status = 'streaming'");
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_summary ON messages(session_id, summary) WHERE summary = 1');
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id)');

  // Migrate: add sequence column to messages if missing
  try {
    db.run('ALTER TABLE messages ADD COLUMN sequence INTEGER');
  } catch {
    // Column already exists
  }

  // Backfill sequence values for existing rows, then create unique index
  migrateMessageSequence(db, options.perfDiagnosticsEnabled);

  // Phase 2: Partial index for efficient compaction boundary lookup
  // (must be after sequence column migration)
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_compaction_summary_sequence ON messages(session_id, sequence DESC) WHERE summary = 1 AND mode = 'compaction'");

  db.run(`
    CREATE TABLE IF NOT EXISTS parts (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      call_id TEXT,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,

      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_parts_message ON parts(message_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_parts_session ON parts(session_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_parts_type ON parts(type)');

  // Migrate: add call_id column to parts if missing
  try {
    db.run('ALTER TABLE parts ADD COLUMN call_id TEXT');
  } catch {
    // Column already exists
  }

  // Phase 4: Backfill call_id from JSON for legacy tool rows, then create partial index
  migratePartsCallId(db);

  // Migrate: add structured_output column to messages if missing
  try {
    db.run('ALTER TABLE messages ADD COLUMN structured_output TEXT');
  } catch {
    // Column already exists
  }

  // Migrate: add tags column to sessions if missing
  try {
    db.run("ALTER TABLE sessions ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
  } catch {
    // Column already exists
  }

  // Migrate: add auto_approve_severity column to sessions if missing
  try {
    db.run('ALTER TABLE sessions ADD COLUMN auto_approve_severity TEXT');
  } catch {
    // Column already exists
  }

  // Migrate: add agent_id column to sessions if missing
  try {
    db.run('ALTER TABLE sessions ADD COLUMN agent_id TEXT');
  } catch {
    // Column already exists
  }

  // Migrate: add cache token columns to sessions if missing
  for (const column of ['cache_read_tokens', 'cache_write_tokens', 'no_cache_tokens']) {
    try {
      db.run(`ALTER TABLE sessions ADD COLUMN ${column} INTEGER DEFAULT 0`);
    } catch {
      // Column already exists
    }
  }

  // Migrate: add cache token columns to messages if missing
  for (const column of ['tokens_cache_read', 'tokens_cache_write', 'tokens_no_cache']) {
    try {
      db.run(`ALTER TABLE messages ADD COLUMN ${column} INTEGER DEFAULT 0`);
    } catch {
      // Column already exists
    }
  }
}

/**
 * Phase 4: Migrate parts.call_id.
 * Backfill from JSON for legacy tool rows, then create the partial composite index.
 *
 * Safe to run on every startup: backfill is idempotent (only touches call_id IS NULL rows),
 * and the index uses IF NOT EXISTS.
 */
function migratePartsCallId(db: Database): void {
  // Backfill call_id from JSON for legacy tool rows
  const needsBackfill = (
    db.query(
      `SELECT COUNT(*) as cnt FROM parts
       WHERE type = 'tool'
         AND call_id IS NULL
         AND JSON_TYPE(data, '$.callId') = 'text'`,
    ).get() as { cnt: number }
  ).cnt;

  if (needsBackfill > 0) {
    const totalUpdated = db.run(
      `UPDATE parts
       SET call_id = JSON_EXTRACT(data, '$.callId')
       WHERE type = 'tool'
         AND call_id IS NULL
         AND JSON_TYPE(data, '$.callId') = 'text'`,
    ).changes;

    if (totalUpdated > 0) {
      console.log(`[migration] Backfilled call_id for ${totalUpdated} tool part(s)`);
    }
  }

  // Partial composite index for session-scoped tool call lookups
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_parts_session_call_id
     ON parts(session_id, call_id)
     WHERE type = 'tool' AND call_id IS NOT NULL`,
  );
}

/**
 * Migrate messages.sequence:
 * 1. Backfill NULL sequence values in legacy insertion order.
 * 2. Validate no duplicates or nulls remain.
 * 3. Create the unique index if validation passes.
 *
 * Safe to run on every startup: backfill is idempotent (only touches NULL rows),
 * validation is a no-op when already clean, and the index uses IF NOT EXISTS.
 */
function migrateMessageSequence(db: Database, perfDiagnosticsEnabled: boolean): void {
  // Check if there are any rows needing backfill
  const nullCount = (
    db.query('SELECT COUNT(*) as cnt FROM messages WHERE sequence IS NULL').get() as { cnt: number }
  ).cnt;

  if (nullCount > 0) {
    backfillMessageSequence(db);
  }

  // Validate: check for nulls or duplicate (session_id, sequence) pairs
  const conflicts = (
    db.query(
      `SELECT session_id, sequence, COUNT(*) as cnt
       FROM messages
       GROUP BY session_id, sequence
       HAVING sequence IS NULL OR cnt > 1`,
    ).all() as { session_id: string; sequence: number | null; cnt: number }[]
  );

  if (conflicts.length === 0) {
    db.run(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_sequence ON messages(session_id, sequence)',
    );
  } else if (perfDiagnosticsEnabled) {
    console.warn(
      `[migration] messages.sequence has ${conflicts.length} conflict(s), skipping unique index creation`,
    );
  }
}

/**
 * Backfill sequence values for rows with NULL sequence.
 * Assigns per-session monotonic values based on legacy (created_at, rowid) order.
 * Restartable: only touches rows where sequence IS NULL.
 */
function backfillMessageSequence(db: Database): void {
  const BATCH_SIZE = 5000;
  let totalBackfilled = 0;

  while (true) {
    const batchResult = db.transaction(() => {
      // Find rows needing backfill, batch by session
      const rows = db.query(
        `SELECT rowid, session_id
         FROM messages
         WHERE sequence IS NULL
         ORDER BY session_id ASC, created_at ASC, rowid ASC
         LIMIT ?`,
      ).all(BATCH_SIZE) as { rowid: number; session_id: string }[];

      if (rows.length === 0) return 0;

      const updateStmt = db.prepare(
        'UPDATE messages SET sequence = ? WHERE rowid = ?',
      );

      // Track per-session sequence counters within this batch
      const sessionCounters = new Map<string, number>();

      // For each session, find the current MAX(sequence) as starting point
      const sessionIds = [...new Set(rows.map((r) => r.session_id))];
      for (const sid of sessionIds) {
        const maxResult = (
          db.query(
            'SELECT COALESCE(MAX(sequence), 0) as max_seq FROM messages WHERE session_id = ?',
          ).get(sid) as { max_seq: number }
        );
        sessionCounters.set(sid, maxResult.max_seq);
      }

      for (const row of rows) {
        const next = (sessionCounters.get(row.session_id) ?? 0) + 1;
        sessionCounters.set(row.session_id, next);
        updateStmt.run(next, row.rowid);
      }

      return rows.length;
    })();

    if (batchResult === 0) break;
    totalBackfilled += batchResult;

    if (batchResult < BATCH_SIZE) break;
  }

  if (totalBackfilled > 0) {
    console.log(`[migration] Backfilled sequence for ${totalBackfilled} message(s)`);
  }
}
