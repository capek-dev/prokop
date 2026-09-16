import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createProvidersApplication } from '@/application/providers';
import { HttpError } from '@/application/http-errors';
import type { ConfigurationApplication } from '@/application/config';
import { CodexAccountStore } from '@/infrastructure/providers/codex-accounts';
import { registerConfigRoutes } from '@/transport/http/routes/config';

describe('Codex account HTTP and application boundary', () => {
  let dir: string;
  let store: CodexAccountStore;
  let app: Hono;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'codex-http-'));
    store = new CodexAccountStore(() => join(dir, 'codex.json'));
    store.add({ access_token: 'secret-a', refresh_token: 'refresh-a' });
    store.add({ access_token: 'secret-b', refresh_token: 'refresh-b' });
    const providers = createProvidersApplication({
      registry: {
        list: () => [{ id: 'codex', displayName: 'Codex', authType: 'oauth', connectable: true, ...store.status() }],
        status: () => store.status(),
        connect: async () => ({}),
        disconnect: async () => store.disconnect(),
      },
      oauth: {
        initiate: async () => { throw new Error('Not used'); },
        complete: async () => ({ providerId: 'codex' }),
        serverCallback: async () => ({ body: '', status: 200, contentType: 'text/html' }),
      },
      credentials: {
        list: () => ({ providers: [] }),
        set: async provider => ({ provider, configured: true }),
        clear: async provider => ({ provider, configured: false }),
      },
      accounts: store,
    });
    app = new Hono();
    app.onError((error, c) => {
      if (error instanceof HttpError && error.status === 404) return c.json({ error: error.code }, 404);
      throw error;
    });
    registerConfigRoutes(app, providers, {} as ConfigurationApplication);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('lists safe metadata, switches, persists, and removes one account', async () => {
    const b = store.status().accounts![1].id;
    const listed = await app.request('/api/providers');
    const body = await listed.text();
    expect(body).toContain('Account 2');
    expect(body).not.toContain('secret-');
    expect(body).not.toContain('refresh-');
    const activate = await app.request(`/api/providers/codex/accounts/${b}/activate`, { method: 'POST' });
    expect(activate.status).toBe(200);
    expect(await activate.json()).toMatchObject({ status: { activeAccountId: b, connected: true } });
    const remove = await app.request(`/api/providers/codex/accounts/${b}`, { method: 'DELETE' });
    expect(remove.status).toBe(200);
    expect(await remove.json()).toMatchObject({ status: { activeAccountId: null, connected: false } });
    expect(store.status().accounts).toHaveLength(1);
  });

  test.each(['missing', '%2E%2E%2Fcodex', '%00'])('rejects unknown or malformed account %s without mutation', async id => {
    const before = store.status();
    const activate = await app.request(`/api/providers/codex/accounts/${id}/activate`, { method: 'POST' });
    expect(activate.status).toBe(404);
    const remove = await app.request(`/api/providers/codex/accounts/${id}`, { method: 'DELETE' });
    expect(remove.status).toBe(404);
    expect(store.status()).toEqual(before);
  });

  test('rejects accounts endpoints for unsupported providers', async () => {
    const id = store.get()!.id;
    const response = await app.request(`/api/providers/openai/accounts/${id}/activate`, { method: 'POST' });
    expect(response.status).toBe(404);
    expect(store.get()?.id).toBe(id);
  });
});
