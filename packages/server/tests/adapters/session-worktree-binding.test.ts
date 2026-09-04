import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createJean2SessionRepository } from '@/adapters/jean2/session-repository';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';

describe('session worktree binding projection', () => {
  beforeEach(() => {
    setupTestDatabase();
    seedWorkspace({ id: 'workspace-1', path: '/repo' });
  });

  afterEach(() => {
    resetTestDatabase();
  });

  test('persists the root ID and projects binding metadata in session payloads', () => {
    const worktrees = createManagedWorktreeRepository(getDatabase);
    worktrees.create({
      id: 'worktree-1',
      name: 'session-root-worktree',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      repositoryRoot: '/repo/.git',
      path: '/data/worktrees/repository-1/worktree-1',
      branch: 'feature/session-root',
      head: 'abc123',
      state: 'available',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const sessions = createJean2SessionRepository({
      getPreconfigOrAgent: async () => null,
      isAgentSync: () => false,
    });

    const created = sessions.createSession({
      id: 'session-1',
      workspaceId: 'workspace-1',
      workspaceRootId: 'worktree-1',
      preconfigId: null,
      title: 'Isolated session',
      status: 'active',
      metadata: null,
      parentId: null,
      agentName: null,
    });

    expect(created.workspaceRootId).toBe('worktree-1');
    expect(created.worktree).toEqual({
      id: 'worktree-1',
      name: 'session-root-worktree',
      branch: 'feature/session-root',
      path: '/data/worktrees/repository-1/worktree-1',
      state: 'available',
    });
    expect(sessions.getSession('session-1')?.worktree).toEqual(created.worktree);
    expect(sessions.listSessionsByWorkspace('workspace-1')[0]?.worktree).toEqual(created.worktree);

    worktrees.update('worktree-1', { state: 'removed' });
    expect(sessions.getSession('session-1')?.worktree?.state).toBe('removed');
  });
});
