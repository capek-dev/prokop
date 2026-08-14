import { Database } from 'bun:sqlite';
import { dirname } from 'path';
import { mkdirSync } from 'fs';

import { resolveDatabasePath } from '@/config';
import { seedBuiltinResponseFormats } from './response-formats';
import { initializeFts, migrateFtsForAgents } from '@/session-search/fts';
import { isPerfDiagnosticsEnabled } from '@/utils/perf';

const PERF_DIAGNOSTICS_ENABLED = isPerfDiagnosticsEnabled();

/**
 * Database Singleton
 *
 * All database access is resolved through a singleton DB instance.
 * In production, the database is lazily created from the resolved path.
 * It can be overridden via:
 *   - DB.configure({ database }) (e.g. for CLI --database flag, or tests)
 *
 * Usage:
 *   import { getDatabase } from '@/store';
 *   const db = getDatabase();
 *
 * Override (generic — not test-specific):
 *   import { DB } from '@/store';
 *   DB.configure({ database: myDb });
 *   DB.reset();
 */
class DatabaseSingleton {
  private dbOverride: Database | null = null;
  private dbDefault: Database | null = null;

  /**
   * Configure the database instance directly.
   * Useful for injecting an in-memory database or a pre-opened connection.
   */
  configure(opts: { database: Database }): void {
    // Close any previous override if it's different
    if (this.dbOverride && this.dbOverride !== opts.database) {
      this.dbOverride.close();
    }
    this.dbOverride = opts.database;
  }

  /**
   * Reset all overrides. Closes the override database if one was set.
   * The lazily-created default database is kept alive (call close() separately if needed).
   */
  reset(): void {
    if (this.dbOverride) {
      this.dbOverride.close();
      this.dbOverride = null;
    }
  }

  /**
   * Close all database connections and reset state completely.
   */
  close(): void {
    if (this.dbOverride) {
      this.dbOverride.close();
      this.dbOverride = null;
    }
    if (this.dbDefault) {
      this.dbDefault.close();
      this.dbDefault = null;
    }
  }

  /**
   * Get the active database instance.
   * Priority:
   *   1. Programmatic override (set via configure)
   *   2. Lazily-created default from resolved path
   */
  getDatabase(): Database {
    if (this.dbOverride) {
      return this.dbOverride;
    }

    if (!this.dbDefault) {
      const dbPath = resolveDatabasePath();
      const dbDir = dirname(dbPath);
      mkdirSync(dbDir, { recursive: true });

      const db = new Database(dbPath);
      db.run('PRAGMA journal_mode = WAL');
      db.run('PRAGMA foreign_keys = ON');
      initializeSchema(db);
      this.dbDefault = db;
    }

    return this.dbDefault;
  }
}

/**
 * Singleton instance. Use DB.configure() / DB.reset() to override.
 */
export const DB = new DatabaseSingleton();

/**
 * Get the active database instance.
 * Convenience free function backed by the singleton.
 */
export function getDatabase(): Database {
  return DB.getDatabase();
}

/**
 * Close all database connections and reset state.
 * Convenience free function backed by the singleton.
 */
export function closeDatabase(): void {
  DB.close();
}

// Force run migrations on the current database
export function runMigrations(): void {
  const database = getDatabase();
  initializeSchema(database);
  console.log('Migrations completed successfully');
}

export function initializeSchema(db: Database): void {
  // Drop legacy tables from the stable release that are no longer used
  db.run('DROP TABLE IF EXISTS tool_permissions');
  db.run('DROP TABLE IF EXISTS tool_approvals');

  db.run(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      is_virtual INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS workspace_paths (
      workspace_id TEXT NOT NULL,
      path TEXT NOT NULL,
      label TEXT,
      PRIMARY KEY (workspace_id, path),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
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
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id)');

  // Phase 5: Workspace-leading indexes for paginated session queries
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_workspace_updated ON sessions(workspace_id, updated_at DESC, id DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_workspace_status_updated ON sessions(workspace_id, status, updated_at DESC, id DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_root_workspace_status_updated ON sessions(workspace_id, status, updated_at DESC, id DESC) WHERE parent_id IS NULL');

  db.run(`
    CREATE TABLE IF NOT EXISTS tool_output_artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      workspace_id TEXT,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      content TEXT NOT NULL,
      format TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_tool_output_artifacts_session_created ON tool_output_artifacts(session_id, created_at, id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tool_output_artifacts_session_call ON tool_output_artifacts(session_id, tool_call_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tool_output_artifacts_workspace ON tool_output_artifacts(workspace_id)');

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
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_session_status ON messages(session_id, status) WHERE status = \'streaming\'');
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_summary ON messages(session_id, summary) WHERE summary = 1');
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id)');

  // Migrate: add sequence column to messages if missing
  try {
    db.run('ALTER TABLE messages ADD COLUMN sequence INTEGER');
  } catch {
    // Column already exists
  }

  // Backfill sequence values for existing rows, then create unique index
  migrateMessageSequence(db);

  // Phase 2: Partial index for efficient compaction boundary lookup
  // (must be after sequence column migration)
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_compaction_summary_sequence ON messages(session_id, sequence DESC) WHERE summary = 1 AND mode = \'compaction\'');

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

  db.run(`CREATE TABLE IF NOT EXISTS permission_grants (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'persistent',
    matcher TEXT NOT NULL DEFAULT 'exact',
    pattern TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    resource TEXT NOT NULL,
    action TEXT,
    allowed INTEGER NOT NULL,
    granted_at TEXT NOT NULL,
    expires_at TEXT,
    granted_by TEXT,
    revoked_at TEXT,
    revoked_by TEXT,
    metadata TEXT,
    bound_root_session_id TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_permission_grants_lookup
    ON permission_grants(workspace_id, tool_name, resource, revoked_at)`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_permission_grants_workspace
    ON permission_grants(workspace_id, revoked_at)`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_permission_grants_pattern
    ON permission_grants(workspace_id, tool_name, pattern)`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_permission_grants_scope
    ON permission_grants(workspace_id, scope, granted_by)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS pending_asks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      ask_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      request_id TEXT,
      workspace_id TEXT,
      root_session_id TEXT,
      origin_session_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at INTEGER,
      resolved_at INTEGER,
      resolution_json TEXT,
      is_permission INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_pending_asks_session ON pending_asks(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pending_asks_tool_call ON pending_asks(tool_call_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pending_asks_request_id ON pending_asks(request_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pending_asks_status ON pending_asks(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pending_asks_root_session ON pending_asks(root_session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pending_asks_workspace ON pending_asks(workspace_id)');

  db.run(`
    CREATE TABLE IF NOT EXISTS queued_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      attachments TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_queued_messages_session ON queued_messages(session_id, position)');

  db.run(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      absolute_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      access_key TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_attachments_session ON attachments(session_id)');

  db.run(`
    CREATE TABLE IF NOT EXISTS terminal_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      shell TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'main',
      status TEXT NOT NULL DEFAULT 'running',
      exit_code INTEGER,
      pid INTEGER,
      cols INTEGER NOT NULL DEFAULT 80,
      rows INTEGER NOT NULL DEFAULT 24,
      created_at INTEGER NOT NULL,
      last_activity_at INTEGER NOT NULL,
      destroyed_at INTEGER,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_terminal_sessions_workspace ON terminal_sessions(workspace_id, status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_terminal_sessions_activity ON terminal_sessions(last_activity_at)');

  db.run(`
    CREATE TABLE IF NOT EXISTS response_formats (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      schema TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_response_formats_name ON response_formats(name)');

  db.run(`
    CREATE TABLE IF NOT EXISTS pinned_messages (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,

      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,

      UNIQUE(workspace_id, message_id)
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_pinned_messages_workspace_created ON pinned_messages(workspace_id, created_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pinned_messages_session ON pinned_messages(session_id)');

  db.run(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_kind TEXT NOT NULL,
      schedule_config TEXT NOT NULL,
      schedule_display TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'active',
      repeat_limit INTEGER,
      run_count INTEGER NOT NULL DEFAULT 0,
      next_run_at INTEGER,
      last_run_at INTEGER,
      last_run_session_id TEXT,
      last_error TEXT,
      reuse_session INTEGER NOT NULL DEFAULT 0,
      include_history INTEGER NOT NULL DEFAULT 0,
      preconfig_id TEXT,
      origin_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      notifications_enabled INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_workspace ON scheduled_jobs(workspace_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run ON scheduled_jobs(state, next_run_at)');

  // Seed built-in response formats
  seedBuiltinResponseFormats(db);

  // Migrate: add reuse_session column to scheduled_jobs if missing
  try {
    db.run('ALTER TABLE scheduled_jobs ADD COLUMN reuse_session INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists
  }

  // Migrate: add include_history column to scheduled_jobs if missing
  try {
    db.run('ALTER TABLE scheduled_jobs ADD COLUMN include_history INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists
  }

  // Migrate: add auto_approve_severity column to scheduled_jobs if missing
  try {
    db.run('ALTER TABLE scheduled_jobs ADD COLUMN auto_approve_severity TEXT');
  } catch {
    // Column already exists
  }

  // Migrate: add notifications_enabled column to scheduled_jobs if missing
  try {
    db.run('ALTER TABLE scheduled_jobs ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists
  }

  // Migrate: add structured_output column to messages if missing
  try {
    db.run('ALTER TABLE messages ADD COLUMN structured_output TEXT');
  } catch {
    // Column already exists
  }

  // Migrate: add settings column to workspaces if missing
  try {
    db.run('ALTER TABLE workspaces ADD COLUMN settings TEXT DEFAULT "{}"');
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

  // ── Web Push tables ──────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_server_id TEXT NOT NULL,
      client_origin TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      expiration_time INTEGER,
      notify_completion INTEGER NOT NULL DEFAULT 1,
      notify_permission INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_success_at INTEGER,
      last_failure_at INTEGER,
      last_failure_reason TEXT
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_push_subscriptions_client_server ON push_subscriptions(client_server_id)');

  db.run(`
    CREATE TABLE IF NOT EXISTS push_deliveries (
      event_id TEXT NOT NULL,
      subscription_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      attempted_at INTEGER,
      next_attempt_at INTEGER,
      delivered_at INTEGER,
      error TEXT,
      PRIMARY KEY (event_id, subscription_id)
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_push_deliveries_retry ON push_deliveries(status, next_attempt_at) WHERE status = 'pending_retry'");

  // Initialize FTS table for session search
  initializeFts(db);
  migrateFtsForAgents(db);
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
function migrateMessageSequence(db: Database): void {
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
  } else if (PERF_DIAGNOSTICS_ENABLED) {
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

export { Database };

// Re-export all store modules
export * from './sessions';
export * from './messages';
export * from './workspaces';
export * from './permissions';
export * from './queued-messages';
export * from './terminal-sessions';
export * from './tool-output-artifacts';

// Re-export session cleanup functions for workspace deletion
export { cleanupSessionOutputDir, cleanupSessionsOutputDirs, cleanupWorkspaceSessionsOutputDirs, deleteSessionsByWorkspace } from './sessions';

// Re-export for recovery functions
export { findOrphanedCompactionTriggers } from './messages';
export { reconcileSessionCompaction, reconcileAllSessionsCompaction } from './compaction-recovery';

// Re-export attachment functions
export * from './attachments';
export { deleteAttachmentsForSession, deleteAttachmentsForWorkspace, getAttachment } from './attachments';

// Re-export pending asks functions
export * from './pending-asks';
export * from './response-formats';
export * from './pinned-messages';

// Re-export cleanup
export { cleanupOrphanedData, vacuumDatabase } from './cleanup';
export type { CleanupStats, VacuumResult } from './cleanup';

// Re-export scheduled jobs
export * from './scheduled-jobs';

// Re-export web push store
export * from './web-push';
