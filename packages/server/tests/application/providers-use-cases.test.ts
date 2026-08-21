import { describe, expect, test } from 'bun:test';
import type { ProviderDescriptor, ProviderStatus } from '@prokopai/sdk';
import {
  createProvidersApplication,
  type ProvidersApplication,
} from '@/application/providers';
import type {
  OAuthFlowPort,
  ProviderCredentialPort,
  ProviderRegistryPort,
} from '@/application/ports/provider-accounts';

interface FakeState {
  providers: Array<{ descriptor: ProviderDescriptor; status: ProviderStatus }>;
  log: string[];
}

function makeState(): FakeState {
  return {
    providers: [
      {
        descriptor: {
          id: 'codex',
          displayName: 'ChatGPT (Codex)',
          description: 'Use ChatGPT subscription models via OAuth',
          authType: 'oauth',
          connectable: true,
        },
        status: { provider: 'codex', connected: false },
      },
    ],
    log: [],
  };
}

function makeApplication(state: FakeState): ProvidersApplication {
  const registry: ProviderRegistryPort = {
    list() {
      state.log.push('list');
      return state.providers.map((p) => ({ ...p.descriptor, ...p.status }));
    },
    status(providerId) {
      state.log.push(`status:${providerId}`);
      return state.providers.find((p) => p.descriptor.id === providerId)?.status
        ?? { provider: providerId, connected: false };
    },
    async connect(providerId, options) {
      state.log.push(`connect:${providerId}:${options?.redirectStrategy ?? 'default'}`);
      return {
        authorizationUrl: 'https://auth/authorize',
        flowId: 'flow-1',
        redirectStrategy: options?.redirectStrategy ?? 'client_redirect',
        redirectUri: 'http://localhost:1455/auth/callback',
      };
    },
    async disconnect(providerId) {
      state.log.push(`disconnect:${providerId}`);
    },
  };

  const oauth: OAuthFlowPort = {
    async initiate(providerId, redirectStrategy) {
      state.log.push(`initiate:${providerId}`);
      return {
        authorizationUrl: 'https://auth/authorize',
        flowId: 'flow-1',
        redirectStrategy: redirectStrategy ?? 'client_redirect',
        redirectUri: 'http://localhost:1455/auth/callback',
      };
    },
    async complete(flowId, code, stateParam, redirectUri) {
      state.log.push(`complete:${flowId}:${code}:${stateParam}:${redirectUri}`);
      return { providerId: 'codex' };
    },
    async serverCallback(providerId, url) {
      state.log.push(`serverCallback:${providerId}:${url.pathname}`);
      return {
        body: '<html>ok</html>',
        status: 200,
        contentType: 'text/html; charset=utf-8',
      };
    },
  };

  const credentials: ProviderCredentialPort = {
    list() {
      state.log.push('credentials:list');
      return { providers: [{ provider: 'openai', configured: true }] };
    },
    async set(provider, apiKey) {
      state.log.push(`credentials:set:${provider}:${apiKey}`);
      return { provider, configured: true };
    },
    async clear(provider) {
      state.log.push(`credentials:clear:${provider}`);
      return { provider, configured: false };
    },
  };

  return createProvidersApplication({ registry, oauth, credentials });
}

describe('providers application use cases', () => {
  test('list spreads each descriptor over its status', () => {
    const state = makeState();
    const application = makeApplication(state);

    expect(application.list()).toEqual([
      {
        id: 'codex',
        displayName: 'ChatGPT (Codex)',
        description: 'Use ChatGPT subscription models via OAuth',
        authType: 'oauth',
        connectable: true,
        provider: 'codex',
        connected: false,
      },
    ]);
  });

  test('connect returns the result and the fresh status in order', async () => {
    const state = makeState();
    const application = makeApplication(state);

    const outcome = await application.connect('codex', { redirectStrategy: 'server_callback' });
    expect(outcome).toEqual({
      result: {
        authorizationUrl: 'https://auth/authorize',
        flowId: 'flow-1',
        redirectStrategy: 'server_callback',
        redirectUri: 'http://localhost:1455/auth/callback',
      },
      status: { provider: 'codex', connected: false },
    });
    expect(state.log).toEqual(['connect:codex:server_callback', 'status:codex']);
  });

  test('status and disconnect delegate to the registry', async () => {
    const state = makeState();
    const application = makeApplication(state);

    expect(application.status('codex')).toEqual({ provider: 'codex', connected: false });
    expect(application.status('ghost')).toEqual({ provider: 'ghost', connected: false });
    await application.disconnect('codex');
    expect(state.log).toEqual(['status:codex', 'status:ghost', 'disconnect:codex']);
  });

  test('completeOAuth and serverCallback delegate with the exact inputs', async () => {
    const state = makeState();
    const application = makeApplication(state);

    expect(await application.completeOAuth('flow-1', 'code', 'state', 'http://cb')).toEqual({ providerId: 'codex' });
    expect(state.log).toContain('complete:flow-1:code:state:http://cb');

    const callback = await application.serverCallback('codex', new URL('https://server/api/providers/codex/oauth/callback?code=c'));
    expect(callback).toEqual({
      body: '<html>ok</html>',
      status: 200,
      contentType: 'text/html; charset=utf-8',
    });
  });

  test('credential use cases delegate and pass the raw api key through', async () => {
    const state = makeState();
    const application = makeApplication(state);

    expect(application.listCredentials()).toEqual({ providers: [{ provider: 'openai', configured: true }] });
    expect(await application.setCredential('openai', '  secret  ')).toEqual({ provider: 'openai', configured: true });
    expect(await application.clearCredential('openai')).toEqual({ provider: 'openai', configured: false });
    expect(state.log).toEqual([
      'credentials:list',
      'credentials:set:openai:  secret  ',
      'credentials:clear:openai',
    ]);
  });
});
