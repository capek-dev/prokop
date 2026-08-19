import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { ConfigurationApplication } from '@/application/config';
import type { ProvidersApplication } from '@/application/providers';
import type { ProviderDescriptor } from '@jean2/sdk';

mock.module('@/config/models', () => ({
  getModelsConfigWithStatus: () => ({ providers: [], defaultModel: '', defaultProvider: '' }),
  createProvider: async (input: unknown) => input,
  updateProvider: async (id: string, input: unknown) => ({ id, ...(input as object) }),
  deleteProvider: async () => ({ success: true }),
  createModel: async (id: string, input: unknown) => ({ providerId: id, ...(input as object) }),
  updateModel: async (_id: string, _m: string, input: unknown) => input,
  deleteModel: async () => ({ success: true }),
  setDefaults: async (input: unknown) => input,
}));
mock.module('@/config/models-sync', () => ({
  syncModels: async (mode: string) => ({ mode }),
}));
mock.module('@/config/prompts', () => ({
  listPromptConfigs: async () => [],
  getPromptConfig: async () => null,
  createPromptConfig: async (input: unknown) => input,
  updatePromptConfig: async (_name: string, input: unknown) => input,
  deletePromptConfig: async () => {},
}));
mock.module('@/config/preconfigs', () => ({
  listValidatedPreconfigs: async () => [],
  createValidatedPreconfig: async (input: unknown) => input,
  updateValidatedPreconfig: async (_id: string, input: unknown) => input,
  deleteValidatedPreconfig: async () => {},
}));
mock.module('@/config/prompts-registry', () => ({
  listPrompts: async () => [],
}));

const { registerConfigRoutes } = await import('@/transport/http/routes/config');

const descriptor: ProviderDescriptor = {
  id: 'codex',
  displayName: 'ChatGPT (Codex)',
  description: 'Use ChatGPT subscription models via OAuth',
  authType: 'oauth',
  connectable: true,
};

function makeFakeApplication(overrides: Partial<ProvidersApplication> = {}): ProvidersApplication {
  return {
    list: () => [{ ...descriptor, provider: 'codex', connected: true, accountId: 'acct' }],
    status: () => ({ provider: 'codex', connected: true }),
    connect: async () => ({
      result: {
        authorizationUrl: 'https://auth/authorize',
        flowId: 'flow-1',
        redirectStrategy: 'client_redirect',
        redirectUri: 'http://localhost:1455/auth/callback',
      },
      status: { provider: 'codex', connected: false },
    }),
    disconnect: async () => {},
    completeOAuth: async () => ({ providerId: 'codex' }),
    serverCallback: async () => ({
      body: '<html>connected</html>',
      status: 200,
      contentType: 'text/html; charset=utf-8',
    }),
    listCredentials: () => ({ providers: [{ provider: 'openai', configured: true }] }),
    setCredential: async (provider) => ({ provider, configured: true }),
    clearCredential: async (provider) => ({ provider, configured: false }),
    ...overrides,
  };
}

function makeApp(application: ProvidersApplication): Hono {
  const app = new Hono();
  registerConfigRoutes(app, application, {} as ConfigurationApplication);
  return app;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

describe('provider route contract', () => {
  afterEach(() => {
    mock.restore();
  });

  test('GET /api/providers returns the descriptor-status spread list', async () => {
    const res = await makeApp(makeFakeApplication()).request('/api/providers');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      providers: [{
        id: 'codex',
        displayName: 'ChatGPT (Codex)',
        description: 'Use ChatGPT subscription models via OAuth',
        authType: 'oauth',
        connectable: true,
        provider: 'codex',
        connected: true,
        accountId: 'acct',
      }],
    });
  });

  test('POST connect returns the exact connect body with the post-connect status', async () => {
    const connects: Array<{ id: string; strategy: string | undefined }> = [];
    const app = makeApp(makeFakeApplication({
      connect: async (id, options) => {
        connects.push({ id, strategy: options?.redirectStrategy });
        return {
          result: {
            authorizationUrl: 'https://auth/authorize',
            flowId: 'flow-9',
            redirectStrategy: 'server_callback',
            redirectUri: 'https://server/cb',
          },
          status: { provider: id, connected: false },
        };
      },
    }));

    const res = await app.request('/api/providers/codex/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirectStrategy: 'server_callback' }),
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      authorizationUrl: 'https://auth/authorize',
      flowId: 'flow-9',
      redirectStrategy: 'server_callback',
      redirectUri: 'https://server/cb',
      status: { provider: 'codex', connected: false },
    });
    expect(connects).toEqual([{ id: 'codex', strategy: 'server_callback' }]);
  });

  test('GET status and DELETE disconnect preserve the exact shapes', async () => {
    const app = makeApp(makeFakeApplication());
    const status = await app.request('/api/providers/codex/status');
    expect(status.status).toBe(200);
    expect(await json(status)).toEqual({ status: { provider: 'codex', connected: true } });

    const deletes: string[] = [];
    const deleteApp = makeApp(makeFakeApplication({
      disconnect: async (id) => {
        deletes.push(id);
      },
    }));
    const removed = await deleteApp.request('/api/providers/codex', { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(await json(removed)).toEqual({ success: true });
    expect(deletes).toEqual(['codex']);
  });

  test('POST /api/oauth/callback completes the flow with the exact body', async () => {
    const completions: Array<{ flowId: string; code: string; state: string; redirectUri: string }> = [];
    const app = makeApp(makeFakeApplication({
      completeOAuth: async (flowId, code, state, redirectUri) => {
        completions.push({ flowId, code, state, redirectUri });
        return { providerId: 'codex' };
      },
    }));

    const res = await app.request('/api/oauth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flowId: 'flow-1', code: 'c', state: 's', redirectUri: 'http://cb' }),
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ success: true, provider: 'codex' });
    expect(completions).toEqual([{ flowId: 'flow-1', code: 'c', state: 's', redirectUri: 'http://cb' }]);
  });

  test('GET server callback returns the exact HTML response', async () => {
    const app = makeApp(makeFakeApplication());
    const res = await app.request('/api/providers/codex/oauth/callback?code=c&state=s');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toBe('<html>connected</html>');
  });

  test('config provider credential routes preserve the exact shapes', async () => {
    const sets: Array<{ provider: string; apiKey: string }> = [];
    const clears: string[] = [];
    const app = makeApp(makeFakeApplication({
      setCredential: async (provider, apiKey) => {
        sets.push({ provider, apiKey });
        return { provider, configured: true };
      },
      clearCredential: async (provider) => {
        clears.push(provider);
        return { provider, configured: false };
      },
    }));

    const list = await app.request('/api/config/providers');
    expect(list.status).toBe(200);
    expect(await json(list)).toEqual({ providers: [{ provider: 'openai', configured: true }] });

    const set = await app.request('/api/config/providers/openai', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-secret' }),
    });
    expect(set.status).toBe(200);
    expect(await json(set)).toEqual({ provider: 'openai', configured: true });
    expect(sets).toEqual([{ provider: 'openai', apiKey: 'sk-secret' }]);

    const clear = await app.request('/api/config/providers/openai', { method: 'DELETE' });
    expect(clear.status).toBe(200);
    // Pre-S4 legacy shape: the route returned the unawaited clear promise,
    // which JSON-serializes to an empty object. Preserved exactly.
    expect(await json(clear)).toEqual({});
    expect(clears).toEqual(['openai']);
  });
});
