import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { registerWorkspaceRoutes } from '@/transport/http/routes/workspaces';
import { HttpError } from '@/application/http-errors';
import type { WorkspaceApplication } from '@/application/workspaces';
import type { PinnedMessage, Session, Workspace } from '@prokopai/sdk';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    name: 'Workspace',
    path: '/ws',
    isVirtual: false,
    additionalPaths: [],
    settings: { autoApproveSeverity: 'low' },
    createdAt: 'c',
    updatedAt: 'u',
    ...overrides,
  } as Workspace;
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    workspaceId: 'ws-1',
    preconfigId: null,
    title: null,
    status: 'active',
    metadata: null,
    parentId: null,
    agentName: null,
    autoApproveSeverity: 'low',
    createdAt: 'c',
    updatedAt: 'u',
    ...overrides,
  } as Session;
}

function makeFakeApplication(overrides: Partial<WorkspaceApplication> = {}): WorkspaceApplication {
  return {
    list: () => ({ kind: 'ok', workspaces: [makeWorkspace()] }),
    get: (id) => (id === 'ws-1' ? makeWorkspace() : null),
    create: () => ({ kind: 'created', workspace: makeWorkspace() }),
    update: () => ({ kind: 'ok', workspace: makeWorkspace() }),
    deleteWorkspace: async () => ({ kind: 'ok', deletedSessions: ['sess-1'] }),
    listTerminals: () => ({ kind: 'ok', sessions: [{ id: 't-1' }] }),
    createTerminal: () => ({ kind: 'ok', session: { id: 't-1' } }),
    getTerminal: (sessionId) => (sessionId === 't-1' ? { id: 't-1' } : null),
    destroyTerminal: () => {},
    listSessions: () => ({ kind: 'ok', sessions: [makeSession()] }),
    listSessionPage: () => ({
      kind: 'ok',
      page: {
        sessions: [makeSession()],
        nextCursor: { version: 1, updatedAt: 'u', id: 'sess-1' },
        hasMore: false,
        limit: 50,
      },
    }),
    listPinned: () => ({ kind: 'ok', pinnedMessages: [] }),
    pin: () => ({ id: 'p-1', workspaceId: 'ws-1', sessionId: 'sess-1', messageId: 'msg-1' } as PinnedMessage),
    unpin: () => ({ kind: 'ok' }),
    encodeCursor: (payload) => `enc:${payload.id}`,
    ...overrides,
  };
}

function makeApp(application: WorkspaceApplication): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      const body: Record<string, unknown> = { error: err.code, message: err.message };
      if (err.details !== undefined) {
        body.details = err.details;
      }
      return c.json(body, err.status as never);
    }
    return c.json({ error: 'Internal Server Error', message: String(err) }, 500 as never);
  });
  registerWorkspaceRoutes(app, application);
  return app;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

describe('workspace route contract', () => {
  test('GET list returns the application workspaces', async () => {
    const res = await makeApp(makeFakeApplication()).request('/api/workspaces');
    expect(res.status).toBe(200);
    expect((await json(res)).workspaces as unknown[]).toHaveLength(1);
  });

  test('GET list maps the mkdir failure to the exact 500 body', async () => {
    const res = await makeApp(makeFakeApplication({ list: () => ({ kind: 'mkdir_failed' }) }))
      .request('/api/workspaces');
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({
      error: 'Internal Server Error',
      message: 'Failed to create workspace directory',
    });
  });

  test('GET workspace and the exact 404 body', async () => {
    const ok = await makeApp(makeFakeApplication()).request('/api/workspaces/ws-1');
    expect(ok.status).toBe(200);
    expect((await json(ok)).workspace).toEqual(expect.objectContaining({ id: 'ws-1' }));

    const missing = await makeApp(makeFakeApplication({ get: () => null })).request('/api/workspaces/missing');
    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ error: 'not_found', message: 'Workspace not found' });
  });

  test('POST create returns 201 and maps path and mkdir failures', async () => {
    const created: Array<{ name?: string; path?: string; isVirtual?: boolean; additionalPaths?: string[] }> = [];
    const app = makeApp(makeFakeApplication({
      create: (input) => {
        created.push(input);
        return { kind: 'created', workspace: makeWorkspace() };
      },
    }));

    const ok = await app.request('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', isVirtual: true }),
    });
    expect(ok.status).toBe(201);
    expect(created[0]).toEqual({ name: 'Test', path: undefined, isVirtual: true, additionalPaths: undefined });

    const pathApp = makeApp(makeFakeApplication({ create: () => ({ kind: 'path_required' }) }));
    const pathRes = await pathApp.request('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(pathRes.status).toBe(400);
    expect((await json(pathRes)).message).toBe('Path is required for physical workspaces');

    const mkdirApp = makeApp(makeFakeApplication({ create: () => ({ kind: 'mkdir_failed' }) }));
    const mkdirRes = await mkdirApp.request('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', path: '/x' }),
    });
    expect(mkdirRes.status).toBe(400);
    expect((await json(mkdirRes)).message).toBe('Failed to create workspace directory');
  });

  test('PATCH update maps the exact errors and returns the workspace', async () => {
    const updates: unknown[] = [];
    const app = makeApp(makeFakeApplication({
      update: (id, input) => {
        updates.push({ id, input });
        return { kind: 'ok', workspace: makeWorkspace() };
      },
    }));

    const ok = await app.request('/api/workspaces/ws-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(ok.status).toBe(200);
    expect(updates[0]).toEqual({ id: 'ws-1', input: { name: 'Renamed', additionalPaths: undefined, settings: undefined } });

    const noFields = await makeApp(makeFakeApplication({ update: () => ({ kind: 'no_fields' }) }))
      .request('/api/workspaces/ws-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    expect(noFields.status).toBe(400);
    expect((await json(noFields)).message).toBe('Name, additionalPaths, or settings is required');

    const missing = await makeApp(makeFakeApplication({ update: () => ({ kind: 'missing' }) }))
      .request('/api/workspaces/missing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
      });
    expect(missing.status).toBe(404);
  });

  test('DELETE returns the exact success body and 404', async () => {
    const ok = await makeApp(makeFakeApplication()).request('/api/workspaces/ws-1', { method: 'DELETE' });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({ success: true, deletedSessions: ['sess-1'] });

    const missing = await makeApp(makeFakeApplication({ deleteWorkspace: async () => ({ kind: 'missing' }) }))
      .request('/api/workspaces/missing', { method: 'DELETE' });
    expect(missing.status).toBe(404);
  });

  test('terminal routes preserve the exact shapes and statuses', async () => {
    const app = makeApp(makeFakeApplication());

    const list = await app.request('/api/workspaces/ws-1/terminals');
    expect(list.status).toBe(200);
    expect(await json(list)).toEqual({ sessions: [{ id: 't-1' }] });

    const create = await app.request('/api/workspaces/ws-1/terminals', { method: 'POST' });
    expect(create.status).toBe(200);
    expect(await json(create)).toEqual({ session: { id: 't-1' } });

    const get = await app.request('/api/workspaces/ws-1/terminals/t-1');
    expect(get.status).toBe(200);
    expect(await json(get)).toEqual({ id: 't-1' });

    const getMissing = await app.request('/api/workspaces/ws-1/terminals/missing');
    expect(getMissing.status).toBe(404);
    expect(await json(getMissing)).toEqual({ error: 'not_found', message: 'Terminal session not found' });

    const destroy = await app.request('/api/workspaces/ws-1/terminals/t-1', { method: 'DELETE' });
    expect(destroy.status).toBe(200);
    expect(await json(destroy)).toEqual({ success: true });

    const limited = makeApp(makeFakeApplication({ createTerminal: () => ({ kind: 'limit' }) }));
    const limitRes = await limited.request('/api/workspaces/ws-1/terminals', { method: 'POST' });
    expect(limitRes.status).toBe(429);
    expect(await json(limitRes)).toEqual({
      error: 'Limit Reached',
      message: 'Maximum terminal sessions reached for this workspace',
    });
  });

  test('session routes preserve listing, pagination, and the exact errors', async () => {
    const app = makeApp(makeFakeApplication());

    const list = await app.request('/api/workspaces/ws-1/sessions');
    expect(list.status).toBe(200);
    expect((await json(list)).sessions as unknown[]).toHaveLength(1);

    const page = await app.request('/api/workspaces/ws-1/sessions?limit=50');
    expect(page.status).toBe(200);
    expect(await json(page)).toEqual({
      sessions: [expect.objectContaining({ id: 'sess-1' })],
      pagination: { nextCursor: 'enc:sess-1', hasMore: false, limit: 50 },
    });

    const badCursor = await makeApp(makeFakeApplication({
      listSessionPage: () => ({ kind: 'bad_cursor' }),
    })).request('/api/workspaces/ws-1/sessions?cursor=bad');
    expect(badCursor.status).toBe(400);
    expect((await json(badCursor)).message).toBe('Invalid cursor');

    const badLimit = await makeApp(makeFakeApplication({
      listSessionPage: () => ({ kind: 'bad_limit' }),
    })).request('/api/workspaces/ws-1/sessions?limit=0');
    expect(badLimit.status).toBe(400);
    expect((await json(badLimit)).message).toBe('limit must be an integer between 1 and 100');

    const missing = await makeApp(makeFakeApplication({
      listSessions: () => ({ kind: 'missing' }),
    })).request('/api/workspaces/missing/sessions');
    expect(missing.status).toBe(404);
  });

  test('pinned message routes preserve the exact shapes', async () => {
    const app = makeApp(makeFakeApplication());

    const list = await app.request('/api/workspaces/ws-1/pinned-messages');
    expect(list.status).toBe(200);
    expect(await json(list)).toEqual({ pinnedMessages: [] });

    const pin = await app.request('/api/workspaces/ws-1/pinned-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', messageId: 'msg-1' }),
    });
    expect(pin.status).toBe(201);
    expect((await json(pin)).pinnedMessage).toEqual(expect.objectContaining({ id: 'p-1' }));

    const unpin = await app.request('/api/workspaces/ws-1/pinned-messages/msg-1', { method: 'DELETE' });
    expect(unpin.status).toBe(200);
    expect(await json(unpin)).toEqual({ success: true });

    const missing = await makeApp(makeFakeApplication({
      listPinned: () => ({ kind: 'missing' }),
    })).request('/api/workspaces/missing/pinned-messages');
    expect(missing.status).toBe(404);
  });
});
