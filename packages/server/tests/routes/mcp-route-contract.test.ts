import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { registerMcpRoutes } from '@/transport/http/routes/mcp';
import { HttpError } from '@/application/http-errors';
import type { McpHttpApplication } from '@/application/mcp';
import type { McpStatus } from '@jean2/sdk';

const connected: McpStatus = { status: 'connected' };

function makeFakeApplication(overrides: Partial<McpHttpApplication> = {}): McpHttpApplication {
  return {
    status: async () => ({
      kind: 'ok',
      status: { alpha: { config: undefined, status: connected } },
    }),
    connect: async () => ({ kind: 'ok', status: connected }),
    disconnect: async () => ({ kind: 'ok' }),
    restart: async () => ({
      kind: 'ok',
      status: { alpha: { config: undefined, status: connected } },
    }),
    ...overrides,
  };
}

function makeApp(application: McpHttpApplication): Hono {
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
  registerMcpRoutes(app, application);
  return app;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

describe('mcp route contract', () => {
  test('GET status returns the server map and the exact workspace 404', async () => {
    const ok = await makeApp(makeFakeApplication()).request('/api/workspaces/ws-1/mcp/status');
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({
      status: { alpha: { config: undefined, status: { status: 'connected' } } },
    });

    const missing = await makeApp(makeFakeApplication({
      status: async () => ({ kind: 'workspace_not_found' }),
    })).request('/api/workspaces/missing/mcp/status');
    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ error: 'not_found', message: 'Workspace not found' });
  });

  test('POST connect returns the status and maps the exact 404s', async () => {
    const connectedApp: Array<{ id: string; name: string }> = [];
    const app = makeApp(makeFakeApplication({
      connect: async (id, name) => {
        connectedApp.push({ id, name });
        return { kind: 'ok', status: { status: 'connected' } };
      },
    }));
    const ok = await app.request('/api/workspaces/ws-1/mcp/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'alpha' }),
    });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({ status: { status: 'connected' } });
    expect(connectedApp).toEqual([{ id: 'ws-1', name: 'alpha' }]);

    const missing = await makeApp(makeFakeApplication({
      connect: async () => ({ kind: 'workspace_not_found' }),
    })).request('/api/workspaces/missing/mcp/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'alpha' }),
    });
    expect(missing.status).toBe(404);
    expect((await json(missing)).message).toBe('Workspace not found');

    const serverMissing = await makeApp(makeFakeApplication({
      connect: async () => ({ kind: 'server_not_found' }),
    })).request('/api/workspaces/ws-1/mcp/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ghost' }),
    });
    expect(serverMissing.status).toBe(404);
    expect((await json(serverMissing)).message).toBe('MCP server not found in config');
  });

  test('POST disconnect returns the pre-S5 empty body shape', async () => {
    const disconnects: Array<{ id: string; name: string }> = [];
    const app = makeApp(makeFakeApplication({
      disconnect: async (id, name) => {
        disconnects.push({ id, name });
        return { kind: 'ok' };
      },
    }));
    const ok = await app.request('/api/workspaces/ws-1/mcp/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'alpha' }),
    });
    expect(ok.status).toBe(200);
    // The pre-S5 response carried `{ status: undefined }`, which serializes
    // to an empty JSON object.
    expect(await json(ok)).toEqual({});
    expect(disconnects).toEqual([{ id: 'ws-1', name: 'alpha' }]);

    const missing = await makeApp(makeFakeApplication({
      disconnect: async () => ({ kind: 'workspace_not_found' }),
    })).request('/api/workspaces/missing/mcp/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'alpha' }),
    });
    expect(missing.status).toBe(404);
  });

  test('POST restart returns the fresh status map', async () => {
    const restarts: string[] = [];
    const app = makeApp(makeFakeApplication({
      restart: async (id) => {
        restarts.push(id);
        return { kind: 'ok', status: { beta: { config: undefined, status: { status: 'failed', error: 'x' } } } };
      },
    }));
    const ok = await app.request('/api/workspaces/ws-1/mcp/restart', { method: 'POST' });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({
      status: { beta: { config: undefined, status: { status: 'failed', error: 'x' } } },
    });
    expect(restarts).toEqual(['ws-1']);

    const missing = await makeApp(makeFakeApplication({
      restart: async () => ({ kind: 'workspace_not_found' }),
    })).request('/api/workspaces/missing/mcp/restart', { method: 'POST' });
    expect(missing.status).toBe(404);
  });

  test('POST connect validates the name schema', async () => {
    const res = await makeApp(makeFakeApplication()).request('/api/workspaces/ws-1/mcp/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('bad_request');
  });
});
