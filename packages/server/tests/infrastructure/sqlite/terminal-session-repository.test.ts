import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createTerminalSessionRepository } from '@/infrastructure/sqlite/terminal-session-repository';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import { createJean2TerminalSessionPort } from '@/adapters/jean2/terminal';
import type { TerminalSessionRow } from '@/application/ports/terminal';

function makeRepository() {
  return createTerminalSessionRepository(() => getDatabase());
}

function createRunning(id: string, workspaceId: string, overrides: Partial<{ cwd: string; shell: string; pid: number }> = {}) {
  makeRepository().createTerminalSession({
    id,
    workspaceId,
    cwd: overrides.cwd ?? '/term',
    shell: overrides.shell ?? '/bin/bash',
    pid: overrides.pid ?? 12345,
    cols: 80,
    rows: 24,
  });
}

describe('terminal session SQLite repository (exact pre-slice SQL)', () => {
  let workspaceId: string;

  beforeEach(() => {
    setupTestDatabase();
    workspaceId = seedWorkspace({ id: 'ws-term', path: '/term' }).id;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  test('createTerminalSession inserts the exact pre-slice row with pid and defaults', () => {
    const repository = makeRepository();
    repository.createTerminalSession({
      id: 'term-1',
      workspaceId,
      cwd: '/term',
      shell: '/bin/zsh',
      pid: 4242,
      cols: 120,
      rows: 40,
    });

    const row = repository.getTerminalSession('term-1');
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      id: 'term-1',
      workspace_id: workspaceId,
      cwd: '/term',
      shell: '/bin/zsh',
      title: 'main',
      status: 'running',
      exit_code: null,
      pid: 4242,
      cols: 120,
      rows: 40,
      managed_worktree_id: null,
      destroyed_at: null,
    });
    expect(row!.created_at).toBeTypeOf('number');
    expect(row!.last_activity_at).toBe(row!.created_at);
  });

  test('getTerminalSession returns null for missing sessions', () => {
    expect(makeRepository().getTerminalSession('missing')).toBeNull();
  });

  test('persists managed worktree identity independently of cwd', () => {
    createManagedWorktreeRepository(() => getDatabase()).create({
      id: 'worktree-1',
      name: 'test-worktree',
      workspaceId,
      repositoryId: 'repository-1',
      repositoryRoot: '/term/.git',
      path: '/managed/worktree-1',
      branch: 'feature/test',
      head: 'abc123',
      state: 'available',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const repository = makeRepository();
    repository.createTerminalSession({
      id: 'term-worktree',
      workspaceId,
      cwd: '/managed/worktree-1/subdirectory',
      shell: '/bin/zsh',
      pid: 4242,
      cols: 120,
      rows: 40,
      managedWorktreeId: 'worktree-1',
    });

    expect(repository.getTerminalSession('term-worktree')?.managed_worktree_id).toBe('worktree-1');
  });

  test('updateTerminalSessionTitle updates only the title, exactly like the pre-slice store', () => {
    const repository = makeRepository();
    createRunning('term-1', workspaceId);
    const before = repository.getTerminalSession('term-1')!;

    repository.updateTerminalSessionTitle('term-1', 'custom title');

    const after = repository.getTerminalSession('term-1')!;
    expect(after.title).toBe('custom title');
    expect(after.last_activity_at).toBe(before.last_activity_at);
    expect(after.status).toBe('running');
  });

  test('updateTerminalSessionActivity refreshes last_activity_at only', () => {
    const repository = makeRepository();
    createRunning('term-1', workspaceId);
    const before = repository.getTerminalSession('term-1')!;

    repository.updateTerminalSessionActivity('term-1');

    const after = repository.getTerminalSession('term-1')!;
    expect(after.last_activity_at).toBeGreaterThanOrEqual(before.last_activity_at);
    expect(after.status).toBe('running');
    expect(after.exit_code).toBeNull();
  });

  test('markTerminalSessionExited persists status, exit code, and activity in one update', () => {
    const repository = makeRepository();
    createRunning('term-1', workspaceId);

    repository.markTerminalSessionExited('term-1', 7);

    const row = repository.getTerminalSession('term-1')!;
    expect(row.status).toBe('exited');
    expect(row.exit_code).toBe(7);
    expect(row.destroyed_at).toBeNull();
  });

  test('markTerminalSessionDestroyed persists status, destroyed_at, and activity in one update', () => {
    const repository = makeRepository();
    createRunning('term-1', workspaceId);

    repository.markTerminalSessionDestroyed('term-1');

    const row = repository.getTerminalSession('term-1')!;
    expect(row.status).toBe('destroyed');
    expect(row.destroyed_at).toBeTypeOf('number');
    expect(row.exit_code).toBeNull();
  });

  test('listTerminalSessions filters by workspace_id and orders by created_at ascending', () => {
    const repository = makeRepository();
    seedWorkspace({ id: 'ws-other', path: '/other' });
    createRunning('term-a', workspaceId);
    createRunning('term-b', workspaceId);
    createRunning('term-c', 'ws-other');

    const rows = repository.listTerminalSessions(workspaceId);
    expect(rows.map((row) => row.id)).toEqual(['term-a', 'term-b']);
    expect(repository.listTerminalSessions('ws-other').map((row) => row.id)).toEqual(['term-c']);
  });

  test('listActiveTerminalSessions excludes destroyed sessions', () => {
    const repository = makeRepository();
    createRunning('term-1', workspaceId);
    createRunning('term-2', workspaceId);
    repository.markTerminalSessionExited('term-1', 0);
    repository.markTerminalSessionDestroyed('term-2');

    const active = repository.listActiveTerminalSessions(workspaceId);
    expect(active.map((row) => row.id)).toEqual(['term-1']);
    expect(active[0].status).toBe('exited');
  });

  test('cleanupStaleTerminalSessions deletes only destroyed sessions older than one hour', () => {
    const repository = makeRepository();
    createRunning('term-fresh', workspaceId);
    createRunning('term-stale', workspaceId);
    repository.markTerminalSessionDestroyed('term-fresh');
    repository.markTerminalSessionDestroyed('term-stale');

    const oldCutoff = Date.now() - 2 * 60 * 60 * 1000;
    getDatabase().run(
      'UPDATE terminal_sessions SET destroyed_at = ? WHERE id = ?',
      [oldCutoff, 'term-stale'],
    );

    const deleted = repository.cleanupStaleTerminalSessions();
    expect(deleted).toBe(1);
    expect(repository.getTerminalSession('term-stale')).toBeNull();
    expect(repository.getTerminalSession('term-fresh')).not.toBeNull();
  });

  test('cleanupRunningSessionsOnStartup destroys running sessions and leaves exited ones alone', () => {
    const repository = makeRepository();
    createRunning('term-1', workspaceId);
    createRunning('term-2', workspaceId);
    createRunning('term-3', workspaceId);
    repository.markTerminalSessionExited('term-3', 0);

    const count = repository.cleanupRunningSessionsOnStartup();
    expect(count).toBe(2);

    const term1 = repository.getTerminalSession('term-1')!;
    expect(term1.status).toBe('destroyed');
    expect(term1.destroyed_at).toBeTypeOf('number');
    expect(repository.getTerminalSession('term-2')!.status).toBe('destroyed');
    expect(repository.getTerminalSession('term-3')!.status).toBe('exited');
  });

  test('the jean2 adapter port is the repository over the store database', () => {
    const port = createJean2TerminalSessionPort();
    port.createTerminalSession({
      id: 'term-adapter',
      workspaceId,
      cwd: '/term',
      shell: '/bin/sh',
      pid: 99,
      cols: 80,
      rows: 24,
    });

    const row = port.getTerminalSession('term-adapter') as TerminalSessionRow;
    expect(row).toMatchObject({ id: 'term-adapter', pid: 99, status: 'running' });
    port.markTerminalSessionExited('term-adapter', 0);
    expect(port.getTerminalSession('term-adapter')!.status).toBe('exited');
    expect(port.getTerminalSession('term-adapter')!.exit_code).toBe(0);
  });
});
