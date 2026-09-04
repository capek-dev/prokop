import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ManagedWorktree, Session } from '@prokopai/sdk';
import { HttpError } from '@/application/http-errors';
import type { WorktreeApplication } from '@/application/worktrees';
import { registerWorktreeRoutes } from '@/transport/http/routes/worktrees';

const worktree: ManagedWorktree = {
  id: 'worktree-1',
  name: 'test-worktree',
  workspaceId: 'workspace-1',
  repositoryId: 'repository-1',
  path: '/data/worktrees/repository-1/worktree-1',
  branch: 'feature/test',
  head: 'abc123',
  state: 'available',
  dirty: false,
  untrackedCount: 0,
  attachments: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const session: Session = {
  id: 'session-1',
  workspaceId: 'workspace-1',
  workspaceRootId: 'worktree-1',
  worktree: {
    id: 'worktree-1',
    name: 'test-worktree',
    branch: 'feature/test',
    path: worktree.path,
    state: 'available',
  },
  preconfigId: null,
  title: 'Session',
  status: 'active',
  metadata: null,
  parentId: null,
  agentName: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function createTestApp(application: WorktreeApplication): Hono {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json(
        { error: error.code, message: error.message, details: error.details },
        error.status as never,
      );
    }
    return c.json({ error: 'internal_error', message: String(error) }, 500);
  });
  registerWorktreeRoutes(app, application);
  return app;
}

function application(
  overrides: Partial<WorktreeApplication> = {},
): WorktreeApplication {
  return {
    list: async () => ({ ok: true, value: [worktree] }),
    listRefs: async () => ({
      ok: true,
      value: [{
        name: 'main',
        ref: 'refs/heads/main',
        kind: 'local',
        commit: 'abc123',
        current: true,
        checkedOut: true,
      }],
    }),
    refreshAttachments: async () => {},
    create: async () => ({ ok: true, value: worktree }),
    remove: async () => ({ ok: true, value: { ...worktree, state: 'removed' } }),
    bind: async () => ({ ok: true, value: session }),
    unbind: async () => ({
      ok: true,
      value: { ...session, workspaceRootId: null, worktree: null },
    }),
    ...overrides,
  };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('HTTP worktree route contract', () => {
  test('exposes list, create, remove, bind, and unbind results', async () => {
    const calls: unknown[] = [];
    const app = createTestApp(application({
      create: async (workspaceId, input) => {
        calls.push({ workspaceId, input });
        return { ok: true, value: worktree };
      },
      bind: async (sessionId, worktreeId) => {
        calls.push({ sessionId, worktreeId });
        return { ok: true, value: session };
      },
    }));

    const listed = await app.request('/api/workspaces/workspace-1/worktrees');
    expect(listed.status).toBe(200);
    expect(await body(listed)).toEqual({ worktrees: [worktree] });

    const refs = await app.request('/api/workspaces/workspace-1/worktree-refs');
    expect(refs.status).toBe(200);
    expect(await body(refs)).toEqual({
      refs: [{
        name: 'main',
        ref: 'refs/heads/main',
        kind: 'local',
        commit: 'abc123',
        current: true,
        checkedOut: true,
      }],
    });

    const created = await app.request('/api/workspaces/workspace-1/worktrees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-worktree', branch: 'refs/heads/feature/test' }),
    });
    expect(created.status).toBe(201);
    expect(await body(created)).toEqual({ worktree });

    const removed = await app.request('/api/workspaces/workspace-1/worktrees/worktree-1', {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    expect(await body(removed)).toEqual({ worktree: { ...worktree, state: 'removed' } });

    const bound = await app.request('/api/sessions/session-1/worktree', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worktreeId: 'worktree-1' }),
    });
    expect(bound.status).toBe(200);
    expect(await body(bound)).toEqual({ session });

    const unbound = await app.request('/api/sessions/session-1/worktree', {
      method: 'DELETE',
    });
    expect(unbound.status).toBe(200);
    expect(await body(unbound)).toEqual({
      session: { ...session, workspaceRootId: null, worktree: null },
    });
    expect(calls).toEqual([
      {
        workspaceId: 'workspace-1',
        input: { name: 'test-worktree', branch: 'refs/heads/feature/test' },
      },
      { sessionId: 'session-1', worktreeId: 'worktree-1' },
    ]);
  });

  test('rejects malformed input and maps domain failures by category', async () => {
    const app = createTestApp(application({
      list: async () => ({
        ok: false,
        code: 'workspace_not_found',
        message: 'Workspace not found',
      }),
      remove: async () => ({
        ok: false,
        code: 'worktree_dirty',
        message: 'Worktree has uncommitted changes',
      }),
      unbind: async () => ({
        ok: false,
        code: 'git_error',
        message: 'Git failed',
      }),
    }));

    const malformedCreate = await app.request('/api/workspaces/workspace-1/worktrees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', branch: 'refs/remotes/origin/main' }),
    });
    expect(malformedCreate.status).toBe(400);

    const missing = await app.request('/api/workspaces/missing/worktrees');
    expect(missing.status).toBe(404);

    const conflict = await app.request('/api/workspaces/workspace-1/worktrees/worktree-1', {
      method: 'DELETE',
    });
    expect(conflict.status).toBe(409);
    expect(await body(conflict)).toEqual({
      error: 'conflict',
      message: 'Worktree has uncommitted changes',
      details: { code: 'worktree_dirty' },
    });

    const gitFailure = await app.request('/api/sessions/session-1/worktree', {
      method: 'DELETE',
    });
    expect(gitFailure.status).toBe(400);
    expect(await body(gitFailure)).toEqual({
      error: 'bad_request',
      message: 'Git failed',
      details: { code: 'git_error' },
    });
  });
});
