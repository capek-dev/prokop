import { Database } from 'bun:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { resolveDatabasePath } from '@/config';
import { isPerfDiagnosticsEnabled } from '@/utils/perf';
import { initializeSessionMessageSchema } from './session-message-schema';
import { seedBuiltinResponseFormats } from './response-formats';
import { initializeFts, migrateFtsForAgents } from '@/infrastructure/session-search/fts';

const PERF_DIAGNOSTICS_ENABLED = isPerfDiagnosticsEnabled();

class DatabaseSingleton {
  private dbOverride: Database | null = null;
  private dbDefault: Database | null = null;

  configure(opts: { database: Database }): void {
    if (this.dbOverride && this.dbOverride !== opts.database) {
      this.dbOverride.close();
    }
    this.dbOverride = opts.database;
  }

  reset(): void {
    if (this.dbOverride) {
      this.dbOverride.close();
      this.dbOverride = null;
    }
  }

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

  getDatabase(): Database {
    if (this.dbOverride) return this.dbOverride;
    if (!this.dbDefault) {
      const dbPath = resolveDatabasePath();
      mkdirSync(dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      db.run('PRAGMA journal_mode = WAL');
      db.run('PRAGMA foreign_keys = ON');
      initializeSchema(db);
      this.dbDefault = db;
    }
    return this.dbDefault;
  }
}

export const DB = new DatabaseSingleton();

export function getDatabase(): Database {
  return DB.getDatabase();
}

export function closeDatabase(): void {
  DB.close();
}

export function runMigrations(): void {
  initializeSchema(getDatabase());
  console.log('Migrations completed successfully');
}

export function initializeSchema(db: Database): void {
  db.run('DROP TABLE IF EXISTS tool_permissions');
  db.run('DROP TABLE IF EXISTS tool_approvals');

  db.run(`CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    is_virtual INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS workspace_paths (
    workspace_id TEXT NOT NULL,
    path TEXT NOT NULL,
    label TEXT,
    PRIMARY KEY (workspace_id, path),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )`);

  initializeSessionMessageSchema(db, {
    perfDiagnosticsEnabled: PERF_DIAGNOSTICS_ENABLED,
  });

  db.run(`CREATE TABLE IF NOT EXISTS tool_output_artifacts (
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
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_tool_output_artifacts_session_created ON tool_output_artifacts(session_id, created_at, id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tool_output_artifacts_session_call ON tool_output_artifacts(session_id, tool_call_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tool_output_artifacts_workspace ON tool_output_artifacts(workspace_id)');

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
  db.run('CREATE INDEX IF NOT EXISTS idx_permission_grants_lookup ON permission_grants(workspace_id, tool_name, resource, revoked_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_permission_grants_workspace ON permission_grants(workspace_id, revoked_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_permission_grants_pattern ON permission_grants(workspace_id, tool_name, pattern)');
  db.run('CREATE INDEX IF NOT EXISTS idx_permission_grants_scope ON permission_grants(workspace_id, scope, granted_by)');

  db.run(`CREATE TABLE IF NOT EXISTS pending_asks (
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
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_pending_asks_session ON pending_asks(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pending_asks_tool_call ON pending_asks(tool_call_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pending_asks_request_id ON pending_asks(request_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pending_asks_status ON pending_asks(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pending_asks_root_session ON pending_asks(root_session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pending_asks_workspace ON pending_asks(workspace_id)');

  db.run(`CREATE TABLE IF NOT EXISTS queued_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    content TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    attachments TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_queued_messages_session ON queued_messages(session_id, position)');

  db.run(`CREATE TABLE IF NOT EXISTS attachments (
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
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_attachments_session ON attachments(session_id)');

  db.run(`CREATE TABLE IF NOT EXISTS terminal_sessions (
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
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_terminal_sessions_workspace ON terminal_sessions(workspace_id, status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_terminal_sessions_activity ON terminal_sessions(last_activity_at)');

  db.run(`CREATE TABLE IF NOT EXISTS response_formats (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    schema TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_response_formats_name ON response_formats(name)');

  db.run(`CREATE TABLE IF NOT EXISTS pinned_messages (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    UNIQUE(workspace_id, message_id)
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_pinned_messages_workspace_created ON pinned_messages(workspace_id, created_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pinned_messages_session ON pinned_messages(session_id)');

  db.run(`CREATE TABLE IF NOT EXISTS scheduled_jobs (
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
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_workspace ON scheduled_jobs(workspace_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run ON scheduled_jobs(state, next_run_at)');

  seedBuiltinResponseFormats(db);
  for (const sql of [
    'ALTER TABLE scheduled_jobs ADD COLUMN reuse_session INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE scheduled_jobs ADD COLUMN include_history INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE scheduled_jobs ADD COLUMN auto_approve_severity TEXT',
    'ALTER TABLE scheduled_jobs ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE workspaces ADD COLUMN settings TEXT DEFAULT "{}"',
  ]) {
    try { db.run(sql); } catch { /* existing column */ }
  }

  db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
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
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_push_subscriptions_client_server ON push_subscriptions(client_server_id)');

  db.run(`CREATE TABLE IF NOT EXISTS push_deliveries (
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
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_push_deliveries_retry ON push_deliveries(status, next_attempt_at) WHERE status = 'pending_retry'");

  initializeFts(db);
  migrateFtsForAgents(db);
}

export { Database };
