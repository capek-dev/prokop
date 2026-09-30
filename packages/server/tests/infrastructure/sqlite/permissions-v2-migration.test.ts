import { afterEach, beforeEach, expect, test } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { initializeSchema, getDatabase } from '@/infrastructure/sqlite/database';
import { initializeSessionMessageSchema } from '@/infrastructure/sqlite/session-message-schema';
import { createWorkspace } from '@/infrastructure/sqlite/workspaces';
import { createGrantFromOptions } from '@/infrastructure/sqlite/permissions';
import { getWorkspacePermissionMode } from '@/infrastructure/sqlite/workspaces';

/**
 * Permissions v2 epoch migration (docs/plans/unified-permissions.md):
 * sessions and scheduled_jobs rename the severity ladder to permission_mode,
 * workspace settings rewrite autoApproveSeverity -> permissionMode, and all
 * stored grants are wiped (they encode severity-ladder semantics the new
 * policy contradicts). The epoch runs once and is idempotent.
 */

function revertToLegacySchema(): void {
  const db = getDatabase();
  db.run('ALTER TABLE sessions DROP COLUMN permission_mode');
  db.run('ALTER TABLE scheduled_jobs DROP COLUMN permission_mode');
}

function insertLegacySession(id: string, severity: string | null): void {
  getDatabase().run(
    `INSERT INTO sessions (id, workspace_id, harness, title, status, created_at, updated_at, auto_approve_severity)
     VALUES (?, 'ws-mig', 'prokop', ?, 'active', ?, ?, ?)`,
    [id, id, new Date().toISOString(), new Date().toISOString(), severity],
  );
}

function insertLegacyJob(id: string, severity: string | null): void {
  getDatabase().run(
    `INSERT INTO scheduled_jobs (id, workspace_id, harness, name, prompt, schedule_kind, schedule_config, schedule_display, state, run_count, reuse_session, include_history, notifications_enabled, created_at, updated_at, auto_approve_severity)
     VALUES (?, 'ws-mig', 'prokop', ?, 'p', 'interval', '{}', 'Every 60m', 'active', 0, 0, 0, 0, ?, ?, ?)`,
    [id, id, Date.now(), Date.now(), severity],
  );
}

function rerunMigrations(): void {
  const db = getDatabase();
  initializeSchema(db);
  initializeSessionMessageSchema(db, { perfDiagnosticsEnabled: false });
}

function sessionMode(id: string): string | null {
  const row = getDatabase()
    .query('SELECT permission_mode FROM sessions WHERE id = ?')
    .get(id) as { permission_mode: string | null } | undefined;
  return row?.permission_mode ?? null;
}

function jobMode(id: string): string | null {
  const row = getDatabase()
    .query('SELECT permission_mode FROM scheduled_jobs WHERE id = ?')
    .get(id) as { permission_mode: string | null } | undefined;
  return row?.permission_mode ?? null;
}

beforeEach(() => {
  setupTestDatabase();
  createWorkspace({ id: 'ws-mig', name: 'Migration', path: '/tmp/mig', isVirtual: false });
});

afterEach(() => {
  resetTestDatabase();
});

test('epoch maps severities to modes on sessions and jobs', () => {
  revertToLegacySchema();
  insertLegacySession('s-high', 'high');
  insertLegacySession('s-medium', 'medium');
  insertLegacySession('s-low', 'low');
  insertLegacySession('s-off', 'off');
  insertLegacySession('s-null', null);
  insertLegacyJob('j-high', 'high');
  insertLegacyJob('j-null', null);

  rerunMigrations();

  expect(sessionMode('s-high')).toBe('full');
  expect(sessionMode('s-medium')).toBe('extended');
  expect(sessionMode('s-low')).toBe('standard');
  expect(sessionMode('s-off')).toBe('standard');
  // Null keeps inheriting the workspace default at read time.
  expect(sessionMode('s-null')).toBeNull();
  expect(jobMode('j-high')).toBe('full');
  expect(jobMode('j-null')).toBeNull();
});

test('epoch rewrites workspace settings and wipes stored grants exactly once', () => {
  revertToLegacySchema();
  const db = getDatabase();
  db.run(`UPDATE workspaces SET settings = ? WHERE id = 'ws-mig'`, [
    JSON.stringify({ autoApproveSeverity: 'medium', memory: { enabled: true } }),
  ]);
  createGrantFromOptions({
    workspaceId: 'ws-mig',
    toolName: 'codex-cli:command',
    resource: 'shell-command',
    action: 'execute',
    permissionKey: '["/tmp","rm -rf build"]',
    grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['["/tmp","rm -rf build"]'] },
  });
  expect(
    (db.query('SELECT COUNT(*) as count FROM permission_grants').get() as { count: number }).count,
  ).toBe(1);

  rerunMigrations();

  const settings = JSON.parse(
    (db.query('SELECT settings FROM workspaces WHERE id = ?').get('ws-mig') as { settings: string }).settings,
  ) as Record<string, unknown>;
  expect(settings.permissionMode).toBe('extended');
  expect(settings.autoApproveSeverity).toBeUndefined();
  expect(settings.memory).toEqual({ enabled: true });
  expect(
    (db.query('SELECT COUNT(*) as count FROM permission_grants').get() as { count: number }).count,
  ).toBe(0);

  // The epoch is one-shot: re-running must not touch re-created grants.
  createGrantFromOptions({
    workspaceId: 'ws-mig',
    toolName: 'codex-cli:command',
    resource: 'shell-command',
    action: 'execute',
    permissionKey: '["/tmp","ls"]',
    grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['["/tmp","ls"]'] },
  });
  rerunMigrations();
  expect(
    (db.query('SELECT COUNT(*) as count FROM permission_grants').get() as { count: number }).count,
  ).toBe(1);
});

test('workspace permission mode reads the migrated settings', () => {
  revertToLegacySchema();
  getDatabase().run(`UPDATE workspaces SET settings = ? WHERE id = 'ws-mig'`, [
    JSON.stringify({ autoApproveSeverity: 'high' }),
  ]);
  rerunMigrations();
  expect(getWorkspacePermissionMode('ws-mig')).toBe('full');
});
