import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { initializeSchema } from '@/infrastructure/sqlite/database';
import { initializeSessionMessageSchema } from '@/infrastructure/sqlite/session-message-schema';
import { createSessionRepository } from '@/infrastructure/sqlite/session-repository';
import { widenSessionHarnessConstraint } from '@/infrastructure/sqlite/claude-harness-migration';

test('widens an existing harness CHECK without losing child rows, indexes or FK enforcement', () => {
  const db = new Database(':memory:');
  try {
    db.run('PRAGMA foreign_keys = ON');
    db.run(`CREATE TABLE sessions (id TEXT PRIMARY KEY, harness TEXT NOT NULL DEFAULT 'prokop'
      CHECK (harness IN ('prokop', 'codex-cli')))`);
    db.run('CREATE INDEX idx_sessions_harness_test ON sessions(harness)');
    db.run('CREATE TABLE children (id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE)');
    db.run("INSERT INTO sessions (id, harness) VALUES ('old', 'codex-cli')");
    db.run("INSERT INTO children (id, session_id) VALUES ('child', 'old')");
    widenSessionHarnessConstraint(db);
    widenSessionHarnessConstraint(db);
    db.run("INSERT INTO sessions (id, harness) VALUES ('new', 'claude-cli')");
    expect(db.query('SELECT * FROM children').all()).toEqual([{ id: 'child', session_id: 'old' }]);
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => db.run("INSERT INTO sessions (id, harness) VALUES ('bad', 'unknown')")).toThrow();
    db.run("DELETE FROM sessions WHERE id = 'old'");
    expect(db.query('SELECT * FROM children').all()).toEqual([]);
  } finally { db.close(); }
});

test('existing session rows acquire the Prokop harness without replacing their data', () => {
  const db = new Database(':memory:');
  try {
    initializeSchema(db);
    db.run('ALTER TABLE sessions DROP COLUMN harness');
    db.run(`INSERT INTO sessions (id, workspace_id, title, status, created_at, updated_at)
      VALUES ('legacy', 'workspace', 'Original title', 'active', '2024-01-01', '2024-01-02')`);

    initializeSessionMessageSchema(db, { perfDiagnosticsEnabled: false });
    initializeSessionMessageSchema(db, { perfDiagnosticsEnabled: false });

    const repo = createSessionRepository(() => db, {
      events: { publish: () => {} },
      deleteAttachmentsForSession: () => {},
      deleteAttachmentsForWorkspace: () => {},
      cleanupSessionOutputDir: () => {},
    });
    expect(repo.getSession('legacy')).toMatchObject({
      title: 'Original title', updatedAt: '2024-01-02', harness: 'prokop',
    });
    const column = db.query<{ name: string }, []>('PRAGMA table_info(sessions)')
      .all().filter(row => row.name === 'harness');
    expect(column).toHaveLength(1);
  } finally {
    db.close();
  }
});

test('existing Codex bindings acquire recovery columns without losing their thread', () => {
  const db = new Database(':memory:');
  try {
    initializeSchema(db);
    db.run('ALTER TABLE codex_session_bindings DROP COLUMN goal_requested');
    db.run('ALTER TABLE codex_session_bindings DROP COLUMN goal_root_turn_id');
    db.run('ALTER TABLE codex_session_bindings DROP COLUMN pending_turn_id');
    db.run('ALTER TABLE codex_session_bindings DROP COLUMN pending_assistant_id');
    db.run('ALTER TABLE codex_session_bindings DROP COLUMN pending_user_id');
    db.run("INSERT INTO sessions (id, workspace_id, harness, status, created_at, updated_at) VALUES ('s', 'w', 'codex-cli', 'active', 'now', 'now')");
    db.run("INSERT INTO codex_session_bindings (session_id, thread_id, cli_version, workspace_root, created_at) VALUES ('s', 't', 'codex-cli 0.156.1', '/tmp', 'now')");
    initializeSessionMessageSchema(db, { perfDiagnosticsEnabled: false });
    initializeSessionMessageSchema(db, { perfDiagnosticsEnabled: false });
    const row = db.query<{ thread_id: string; pending_user_id: string | null; pending_assistant_id: string | null;
      pending_turn_id: string | null; goal_root_turn_id: string | null; goal_requested: number }, []>(
      `SELECT thread_id, pending_user_id, pending_assistant_id, pending_turn_id, goal_root_turn_id, goal_requested
        FROM codex_session_bindings WHERE session_id = 's'`,
    ).get();
    expect(row).toEqual({ thread_id: 't', pending_user_id: null, pending_assistant_id: null,
      pending_turn_id: null, goal_root_turn_id: null, goal_requested: 0 });
  } finally {
    db.close();
  }
});
