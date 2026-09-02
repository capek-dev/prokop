import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { registerToolRoutes } from '@/transport/http/routes/tools';
import { HttpError } from '@/application/http-errors';
import type { ToolsHttpApplication } from '@/application/tools';
import type { ToolCatalogEntry } from '@/application/ports/tool-catalog';
import type { LoadedTool } from '@prokopai/sdk';

function makeDefinition(overrides: Partial<ToolCatalogEntry> = {}): ToolCatalogEntry {
  return {
    name: 'demo',
    description: 'Demo tool',
    inputSchema: { type: 'object', properties: {} },
    timeout: 30000,
    source: 'installed',
    ...overrides,
  } as ToolCatalogEntry;
}

function makeFakeApplication(overrides: Partial<ToolsHttpApplication> = {}): ToolsHttpApplication {
  return {
    listTools: async () => ({ kind: 'ok', tools: [makeDefinition()] }),
    getTool: async (name) =>
      name === 'demo'
        ? { kind: 'ok', tool: makeDefinition() as unknown as LoadedTool }
        : { kind: 'missing' },
    listEnv: async () => ({
      kind: 'ok',
      status: { envVars: [{ key: 'DEMO_KEY', configured: false, sensitive: false }] },
    }),
    setEnv: async () => ({
      kind: 'ok',
      envVar: { key: 'DEMO_KEY', configured: true, sensitive: false },
    }),
    ...overrides,
  };
}

function makeApp(application: ToolsHttpApplication): Hono {
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
  registerToolRoutes(app, application);
  return app;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

describe('tools route contract', () => {
  test('GET /api/tools returns the catalog', async () => {
    const res = await makeApp(makeFakeApplication()).request('/api/tools');
    expect(res.status).toBe(200);
    expect((await json(res)).tools as unknown[]).toHaveLength(1);
  });

  test('GET /api/tools returns an empty list when listing fails', async () => {
    const app = makeApp(makeFakeApplication({ listTools: async () => ({ kind: 'ok', tools: [] }) }));
    const res = await app.request('/api/tools');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ tools: [] });
  });

  test('GET /api/tools/env returns the status object', async () => {
    const res = await makeApp(makeFakeApplication()).request('/api/tools/env');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      envVars: [{ key: 'DEMO_KEY', configured: false, sensitive: false }],
    });
  });

  test('GET /api/tools/env maps failures to the exact 500 body', async () => {
    const app = makeApp(makeFakeApplication({
      listEnv: async () => ({ kind: 'failed', message: 'env read failed' }),
    }));
    const res = await app.request('/api/tools/env');
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ error: 'Failed to list tool env vars', message: 'env read failed' });
  });

  test('PUT /api/tools/env/:key returns the env var and passes the raw value', async () => {
    const sets: Array<{ key: string; value: string }> = [];
    const app = makeApp(makeFakeApplication({
      setEnv: async (key, value) => {
        sets.push({ key, value });
        return { kind: 'ok', envVar: { key, configured: true, sensitive: false } };
      },
    }));
    const res = await app.request('/api/tools/env/DEMO_KEY', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: '  secret  ' }),
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ envVar: { key: 'DEMO_KEY', configured: true, sensitive: false } });
    // The raw value is passed through; trimming is the use case job.
    expect(sets).toEqual([{ key: 'DEMO_KEY', value: '  secret  ' }]);
  });

  test('PUT /api/tools/env/:key maps invalid and failed results exactly', async () => {
    const invalid = makeApp(makeFakeApplication({
      setEnv: async () => ({ kind: 'invalid', message: 'key must be valid' }),
    }));
    const invalidRes = await invalid.request('/api/tools/env/X', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'v' }),
    });
    expect(invalidRes.status).toBe(400);
    expect(await json(invalidRes)).toEqual({ error: 'Bad Request', message: 'key must be valid' });

    const failed = makeApp(makeFakeApplication({
      setEnv: async () => ({ kind: 'failed', message: 'write failed' }),
    }));
    const failedRes = await failed.request('/api/tools/env/X', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'v' }),
    });
    expect(failedRes.status).toBe(500);
    expect(await json(failedRes)).toEqual({ error: 'Internal Server Error', message: 'write failed' });
  });

  test('PUT /api/tools/env/:key returns 400 for invalid bodies', async () => {
    const res = await makeApp(makeFakeApplication()).request('/api/tools/env/X', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: '' }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('bad_request');
  });

  test('GET /api/tools/:name returns the tool and the exact 404 body', async () => {
    const ok = await makeApp(makeFakeApplication()).request('/api/tools/demo');
    expect(ok.status).toBe(200);
    expect((await json(ok)).tool).toEqual(expect.objectContaining({ name: 'demo' }));

    const missing = await makeApp(makeFakeApplication()).request('/api/tools/missing');
    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ error: 'not_found', message: 'Tool not found' });
  });
});
