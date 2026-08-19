import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { registerAgentRoutes } from '@/transport/http/routes/agents';
import { HttpError } from '@/application/http-errors';
import type { AgentsApplication } from '@/application/agents';
import type { Agent, Preconfig } from '@jean2/sdk';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'coder',
    name: 'Coder',
    description: '',
    systemPrompt: 'PROMPT',
    tools: [],
    model: null,
    provider: null,
    variant: null,
    settings: null,
    isDefault: false,
    hasHome: true,
    createdAt: '2026-08-16T00:00:00.000Z',
    ...overrides,
  } as Agent;
}

function makeFakeApplication(overrides: Partial<AgentsApplication> = {}): AgentsApplication {
  return {
    getAgentDirectory: async () => null,
    isAgentSync: () => false,
    isAgent: async () => false,
    listAgents: async () => [makeAgent()],
    getAgent: async () => makeAgent(),
    getPreconfigOrAgent: async () => null as unknown as Preconfig,
    promotePreconfig: async () => makeAgent(),
    demoteAgent: async () => {},
    readAgentMemoryFile: async () => null,
    writeAgentMemoryFile: async () => {},
    getAgentMemory: async () => ({ user: 'USER', memory: 'MEMORY' }),
    updateAgentMemory: async () => {},
    ...overrides,
  };
}

function makeApp(application: AgentsApplication): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      const body: Record<string, unknown> = { error: err.code, message: err.message };
      if (err.details !== undefined) {
        body.details = err.details;
      }
      return c.json(body, err.status as never);
    }
    return c.json({ error: 'Internal Server Error', message: err instanceof Error ? err.message : String(err) }, 500 as never);
  });
  registerAgentRoutes(app, application);
  return app;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

describe('agent route contract', () => {
  test('GET /api/agents returns the application list', async () => {
    const app = makeApp(makeFakeApplication());
    const res = await app.request('/api/agents');
    expect(res.status).toBe(200);
    expect((await json(res)).agents as unknown[]).toHaveLength(1);
  });

  test('GET /api/agents/:id returns 404 with the exact body for a missing agent', async () => {
    const app = makeApp(makeFakeApplication({ getAgent: async () => null }));
    const res = await app.request('/api/agents/missing');
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'not_found', message: 'Agent not found' });
  });

  test('POST /api/agents/:id/promote returns the promoted agent', async () => {
    const promoted: string[] = [];
    const app = makeApp(
      makeFakeApplication({
        promotePreconfig: async (id) => {
          promoted.push(id);
          return makeAgent({ id });
        },
      }),
    );
    const res = await app.request('/api/agents/coder/promote', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await json(res)).agent).toEqual(expect.objectContaining({ id: 'coder' }));
    expect(promoted).toEqual(['coder']);
  });

  test('POST promote lets application errors propagate to the error handler', async () => {
    const app = makeApp(
      makeFakeApplication({
        promotePreconfig: async () => {
          throw new Error('Preconfig not found');
        },
      }),
    );
    const res = await app.request('/api/agents/missing/promote', { method: 'POST' });
    expect(res.status).toBe(500);
    expect((await json(res)).message).toBe('Preconfig not found');
  });

  test('DELETE /api/agents/:id returns success:true even when the agent is absent', async () => {
    const app = makeApp(makeFakeApplication());
    const res = await app.request('/api/agents/coder', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ success: true });
  });

  test('GET /api/agents/:id/memory returns the memory pair', async () => {
    const app = makeApp(makeFakeApplication());
    const res = await app.request('/api/agents/coder/memory');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ user: 'USER', memory: 'MEMORY' });
  });

  test('PATCH /api/agents/:id/memory passes the validated target and content through', async () => {
    const updates: Array<{ id: string; target: string; content: string }> = [];
    const app = makeApp(
      makeFakeApplication({
        updateAgentMemory: async (id, target, content) => {
          updates.push({ id, target, content });
        },
      }),
    );
    const res = await app.request('/api/agents/coder/memory', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'user', content: '- pref' }),
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ success: true });
    expect(updates).toEqual([{ id: 'coder', target: 'user', content: '- pref' }]);
  });

  test('PATCH /api/agents/:id/memory returns 400 for invalid target', async () => {
    const app = makeApp(makeFakeApplication());
    const res = await app.request('/api/agents/coder/memory', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'other', content: 'x' }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('bad_request');
  });
});
