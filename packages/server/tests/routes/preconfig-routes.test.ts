import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { ConfigurationApplication } from '@/application/configuration';

const createValidatedPreconfig = mock(async (data: Record<string, unknown>) => ({
  ...data,
  id: 'created-preconfig',
}));
const updateValidatedPreconfig = mock(async (id: string, data: Record<string, unknown>) => ({
  ...data,
  id,
}));

mock.module('@/configuration/preconfigs', () => ({
  listValidatedPreconfigs: mock(async () => []),
  createValidatedPreconfig,
  updateValidatedPreconfig,
  deleteValidatedPreconfig: mock(async () => undefined),
}));

const { registerConfigRoutes } = await import('@/routes/config');

function fakeConfiguration(): ConfigurationApplication {
  return {
    models: {} as ConfigurationApplication['models'],
    prompts: {} as ConfigurationApplication['prompts'],
    preconfigs: {
      listValidatedPreconfigs: async () => [],
      createValidatedPreconfig: createValidatedPreconfig as unknown as ConfigurationApplication['preconfigs']['createValidatedPreconfig'],
      updateValidatedPreconfig: updateValidatedPreconfig as unknown as ConfigurationApplication['preconfigs']['updateValidatedPreconfig'],
      deleteValidatedPreconfig: async () => undefined,
    },
  };
}

function fakeProviders() {
  return {
    list: () => [],
    status: () => ({ provider: '', connected: false }),
    connect: async () => ({ result: {}, status: { provider: '', connected: false } }),
    disconnect: async () => {},
    completeOAuth: async () => ({ providerId: '' }),
    serverCallback: async () => ({ body: '', status: 200, contentType: 'text/html' }),
    listCredentials: () => ({ providers: [] }),
    setCredential: async () => ({ provider: '', configured: false }),
    clearCredential: async () => ({ provider: '', configured: false }),
  };
}

describe('preconfig routes', () => {
  afterEach(() => {
    createValidatedPreconfig.mockClear();
    updateValidatedPreconfig.mockClear();
    mock.restore();
  });

  test('forwards allowSelfAsSubagent on create and update', async () => {
    const app = new Hono();
    registerConfigRoutes(app, fakeProviders(), fakeConfiguration());

    const createResponse = await app.request('/api/preconfigs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Self delegating',
        allowSelfAsSubagent: true,
      }),
    });

    expect(createResponse.status).toBe(201);
    expect(createValidatedPreconfig).toHaveBeenCalledTimes(1);
    expect(createValidatedPreconfig.mock.calls[0]?.[0]).toMatchObject({
      name: 'Self delegating',
      allowSelfAsSubagent: true,
    });

    const updateResponse = await app.request('/api/preconfigs/existing-preconfig', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ allowSelfAsSubagent: false }),
    });

    expect(updateResponse.status).toBe(200);
    expect(updateValidatedPreconfig).toHaveBeenCalledTimes(1);
    expect(updateValidatedPreconfig.mock.calls[0]?.[0]).toBe('existing-preconfig');
    expect(updateValidatedPreconfig.mock.calls[0]?.[1]).toMatchObject({
      allowSelfAsSubagent: false,
    });

    const partialUpdateResponse = await app.request('/api/preconfigs/existing-preconfig', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });

    expect(partialUpdateResponse.status).toBe(200);
    expect(updateValidatedPreconfig).toHaveBeenCalledTimes(2);
    expect(updateValidatedPreconfig.mock.calls[1]?.[1]).not.toHaveProperty('allowSelfAsSubagent');
  });
});
