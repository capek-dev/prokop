import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApp } from '@/transport/http/app';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import { createMessage } from '@/infrastructure/sqlite/message-store';
import { createTestUserMessage } from '#tests/factories';

const temporaryDirectories: string[] = [];

describe('HTTP worktree composition', () => {
  beforeEach(() => {
    setupTestDatabase();
    seedWorkspace({ id: 'workspace-1', path: '/repo' });
  });

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
    resetTestDatabase();
  });

  test('registers worktree routes on the real wired application', async () => {
    const response = await createApp().request('/api/workspaces/workspace-1/worktrees');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ worktrees: [] });
  });

  test('passes workspaceRootId through the real session HTTP route', async () => {
    createManagedWorktreeRepository(getDatabase).create({
      id: 'worktree-1',
      name: 'http-session-worktree',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      repositoryRoot: '/repo/.git',
      path: '/data/worktrees/repository-1/worktree-1',
      branch: 'feature/http-session',
      head: 'abc123',
      state: 'available',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const response = await createApp().request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'workspace-1',
        workspaceRootId: 'worktree-1',
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      session: {
        workspaceId: 'workspace-1',
        workspaceRootId: 'worktree-1',
        worktree: {
          id: 'worktree-1',
          branch: 'feature/http-session',
          state: 'available',
        },
      },
    });
  });

  test('rejects changing checkout after the first message through the real session route', async () => {
    createManagedWorktreeRepository(getDatabase).create({
      id: 'worktree-locked',
      name: 'locked-worktree',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      repositoryRoot: '/repo/.git',
      path: '/data/worktrees/repository-1/worktree-locked',
      branch: 'feature/locked-session',
      head: 'abc123',
      state: 'available',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const createResponse = await createApp().request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'workspace-1' }),
    });
    const created = await createResponse.json() as { session: { id: string } };
    createMessage(createTestUserMessage(created.session.id));

    const response = await createApp().request(`/api/sessions/${created.session.id}/worktree`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worktreeId: 'worktree-locked' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'conflict',
      message: 'A session checkout cannot be changed after its first message',
      details: { code: 'session_has_messages' },
    });
  });

  test('rejects an unavailable workspaceRootId through the real session HTTP route', async () => {
    const response = await createApp().request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'workspace-1',
        workspaceRootId: 'missing-worktree',
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'bad_request',
      message: 'Selected worktree is not available for this workspace',
    });
  });

  test('authorizes an available managed worktree through the real files route', async () => {
    const main = mkdtempSync(join(tmpdir(), 'prokop-files-main-'));
    const worktreePath = mkdtempSync(join(tmpdir(), 'prokop-files-worktree-'));
    temporaryDirectories.push(main, worktreePath);
    seedWorkspace({ id: 'workspace-files', path: main });
    writeFileSync(join(worktreePath, 'from-worktree.txt'), 'available');
    createManagedWorktreeRepository(getDatabase).create({
      id: 'worktree-files',
      name: 'files-worktree',
      workspaceId: 'workspace-files',
      repositoryId: 'repository-files',
      repositoryRoot: main,
      path: worktreePath,
      branch: 'feature/files-root',
      head: 'abc123',
      state: 'available',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const response = await createApp().request(
      `/api/workspaces/workspace-files/files/tree?root=${encodeURIComponent(worktreePath)}`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      root: worktreePath,
      isMain: false,
      paths: ['from-worktree.txt'],
    });
  });

  test('rejects an unavailable managed worktree through the real files route', async () => {
    const main = mkdtempSync(join(tmpdir(), 'prokop-files-main-'));
    const worktreePath = mkdtempSync(join(tmpdir(), 'prokop-files-worktree-'));
    temporaryDirectories.push(main, worktreePath);
    seedWorkspace({ id: 'workspace-files', path: main });
    createManagedWorktreeRepository(getDatabase).create({
      id: 'worktree-files',
      name: 'files-worktree',
      workspaceId: 'workspace-files',
      repositoryId: 'repository-files',
      repositoryRoot: main,
      path: worktreePath,
      branch: 'feature/files-root',
      head: 'abc123',
      state: 'missing',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const response = await createApp().request(
      `/api/workspaces/workspace-files/files/tree?root=${encodeURIComponent(worktreePath)}`,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'bad_request',
      message: 'Invalid workspace root',
    });
  });
});
