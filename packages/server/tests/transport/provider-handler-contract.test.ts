import { afterEach, describe, expect, test } from 'bun:test';
import type { ServerMessage } from '@prokopai/sdk';
import { installWireApplication, type WireApplication } from '@/transport/websocket/application';
import {
  handleProviderConnect,
  handleProviderDisconnect,
} from '@/transport/websocket/handlers/providers';
import type { RouterContext } from '@/transport/websocket/router-context';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import type { ProvidersApplication } from '@/application/providers';
import type { NotificationsApplication } from '@/application/notifications';
import type { PermissionsApplication } from '@/application/permissions';
import type { SessionApplication, SessionControlApplication } from '@/application';

interface Spy {
  broadcasts: ServerMessage[];
  sent: ServerMessage[];
}

function makeCtx(spy: Spy): RouterContext<ConnectionId> {
  return {
    send: (_origin, msg) => spy.sent.push(msg),
    broadcast: (msg) => spy.broadcasts.push(msg),
    broadcastToSession: () => {},
    sendToController: () => {},
    sendToAskTargets: () => {},
    clients: new Map(),
  };
}

function installProviders(providers: ProvidersApplication): void {
  const session = {} as SessionApplication<ConnectionId>;
  const control = {} as SessionControlApplication<ConnectionId>;
  const notifications = makeNotifications();
  const permissions = {} as PermissionsApplication;
  const wire: WireApplication = { session, control, providers, notifications, permissions };
  installWireApplication(wire);
}

function makeNotifications(): NotificationsApplication {
  return {
    getConfig: () => ({ available: true, vapidPublicKey: '', permissionTimeoutMs: 1000 }),
    upsertSubscription: () => ({ id: '', clientId: '', clientServerId: '', clientOrigin: '', expirationTime: null, preferences: { completion: false, permission: false }, createdAt: 0, updatedAt: 0 }),
    updatePreferences: () => null,
    deleteSubscription: () => {},
    dispatch: async () => {},
    notifyTerminalMessage: () => {},
    acknowledgePendingNotification: () => false,
    dispatchPendingPermissionNotification: async () => {},
    notifyPermissionRequired: () => {},
    runRetryTick: async () => {},
    cleanup: () => 0,
  };
}

function makeProviders(overrides: Partial<ProvidersApplication> = {}): ProvidersApplication {
  return {
    list: () => [],
    status: () => ({ provider: '', connected: false }),
    connect: async (providerId, options) => ({
      result: {
        authorizationUrl: 'https://auth/authorize',
        flowId: 'flow-1',
        redirectStrategy: options?.redirectStrategy ?? 'client_redirect',
        redirectUri: 'http://localhost:1455/auth/callback',
      },
      status: { provider: providerId, connected: false },
    }),
    disconnect: async () => {},
    completeOAuth: async () => ({ providerId: '' }),
    serverCallback: async () => ({ body: '', status: 200, contentType: 'text/html' }),
    listCredentials: () => ({ providers: [] }),
    setCredential: async (provider) => ({ provider, configured: false }),
    clearCredential: async (provider) => ({ provider, configured: false }),
    ...overrides,
  };
}

afterEach(() => {
  installProviders(makeProviders());
});

describe('provider wire handler contract', () => {
  test('connect broadcasts the exact provider.status message with the use case outcome', async () => {
    const spy: Spy = { broadcasts: [], sent: [] };
    installProviders(makeProviders({
      connect: async (providerId, options) => ({
        result: {
          authorizationUrl: 'https://auth/authorize',
          flowId: 'flow-9',
          redirectStrategy: options?.redirectStrategy ?? 'client_redirect',
          redirectUri: 'http://localhost:1455/auth/callback',
        },
        status: { provider: providerId, connected: false },
      }),
    }));

    await handleProviderConnect(
      makeCtx(spy),
      'ws' as ConnectionId,
      { type: 'provider.connect', provider: 'codex', redirectStrategy: 'server_callback' },
    );

    expect(spy.broadcasts).toEqual([{
      type: 'provider.status',
      provider: 'codex',
      connected: false,
      authorizationUrl: 'https://auth/authorize',
      flowId: 'flow-9',
      redirectStrategy: 'server_callback',
      redirectUri: 'http://localhost:1455/auth/callback',
    }]);
    expect(spy.sent).toEqual([]);
  });

  test('connect broadcasts the failure shape on rejection', async () => {
    const spy: Spy = { broadcasts: [], sent: [] };
    installProviders(makeProviders({
      connect: async () => {
        throw new Error('credentials missing');
      },
    }));

    await handleProviderConnect(
      makeCtx(spy),
      'ws' as ConnectionId,
      { type: 'provider.connect', provider: 'unknown' },
    );

    expect(spy.broadcasts).toEqual([{
      type: 'provider.status',
      provider: 'unknown',
      connected: false,
      error: 'credentials missing',
    }]);
  });

  test('disconnect broadcasts provider.connected false on success', async () => {
    const spy: Spy = { broadcasts: [], sent: [] };
    const disconnects: string[] = [];
    installProviders(makeProviders({
      disconnect: async (providerId) => {
        disconnects.push(providerId);
      },
    }));

    await handleProviderDisconnect(
      makeCtx(spy),
      'ws' as ConnectionId,
      { type: 'provider.disconnect', provider: 'codex' },
    );

    expect(disconnects).toEqual(['codex']);
    expect(spy.broadcasts).toEqual([{
      type: 'provider.connected',
      provider: 'codex',
      connected: false,
    }]);
    expect(spy.sent).toEqual([]);
  });

  test('disconnect sends the exact provider_error to the origin on rejection', async () => {
    const spy: Spy = { broadcasts: [], sent: [] };
    installProviders(makeProviders({
      disconnect: async () => {
        throw new Error('teardown failed');
      },
    }));

    await handleProviderDisconnect(
      makeCtx(spy),
      'ws' as ConnectionId,
      { type: 'provider.disconnect', provider: 'codex' },
    );

    expect(spy.broadcasts).toEqual([]);
    expect(spy.sent).toEqual([{ type: 'error', code: 'provider_error', message: 'teardown failed' }]);
  });
});
