import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createApp } from '@/transport/http/app';
import { createRemoteAccessService } from '@/application/remote-access/service';
import { createRemoteAccessSettingsRepository } from '@/infrastructure/sqlite/remote-access-settings';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

describe('remote access routes', () => {
  let app: ReturnType<typeof createApp>;
  let host: string;

  const local = (path: string, init?: RequestInit) => app.request(path, init);
  const remote = (path: string, init?: RequestInit) => app.request(`http://prokop.example.com${path}`, init);

  beforeEach(() => {
    setupTestDataDir();
    setupTestDatabase();
    host = '127.0.0.1';
    const remoteAccess = createRemoteAccessService({
      repository: createRemoteAccessSettingsRepository(getDatabase),
      network: {
        interfaces: () => [{ interfaceName: 'en0', address: '192.168.1.5', family: 'IPv4' }],
        tailscale: async () => null,
        setTailscaleServe: async () => {},
      },
      environment: { bindOverride: null, extraHosts: [] },
      listeners: () => ({
        endpoint: () => ({ host, port: 8742, protocol: 'http' }),
        loopbackTarget: () => 'http://127.0.0.1:8742',
        rebind: async (next) => { host = next; },
      }),
    });
    app = createApp(undefined, {
      remoteAccess,
      pairingLinks: (code) => remoteAccess.pairingBaseUrls().map((url) => `${url}/pair#code=${code}`),
    });
  });

  afterEach(() => {
    resetTestDatabase();
    resetTestDataDir();
  });

  test('the server machine turns network listening on and off, persisted in the database', async () => {
    expect(await (await local('/api/remote-access')).json()).toMatchObject({ listenOnNetwork: false, addresses: [] });

    const on = await local('/api/remote-access', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ listenOnNetwork: true }) });
    expect(await on.json()).toMatchObject({ listenOnNetwork: true, bindHost: '0.0.0.0' });
    expect(host).toBe('0.0.0.0');

    const created = await local('/api/auth/pairing-codes', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    const { code, links } = await created.json() as { code: string; links: string[] };
    expect(links).toEqual([`http://192.168.1.5:8742/pair#code=${code}`]);
  });

  test('addresses can be added and removed', async () => {
    const added = await local('/api/remote-access/addresses', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ url: 'prokop.example.com' }),
    });
    expect(await added.json()).toMatchObject({ addresses: [{ url: 'https://prokop.example.com', kind: 'proxy' }] });

    const invalid = await local('/api/remote-access/addresses', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ url: 'http://localhost:8742' }),
    });
    expect(invalid.status).toBe(400);

    const removed = await local(`/api/remote-access/addresses?url=${encodeURIComponent('https://prokop.example.com')}`, {
      method: 'DELETE',
    });
    expect(await removed.json()).toMatchObject({ addresses: [] });
  });

  test('Tailscale errors reach the caller with a reason', async () => {
    const res = await local('/api/remote-access/tailscale', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ enabled: true }) });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ message: expect.stringContaining('not installed') });
  });

  test('paired callers learn the server addresses from auth status; unpaired callers do not', async () => {
    await local('/api/remote-access/addresses', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ url: 'https://studio.ts.net' }) });
    expect(await (await local('/api/auth/status')).json()).toMatchObject({ addresses: ['https://studio.ts.net'] });
    expect(await (await remote('/api/auth/status')).json()).not.toHaveProperty('addresses');
  });

  test('other devices cannot see or change remote access', async () => {
    expect((await remote('/api/remote-access')).status).toBe(401);
    expect((await remote('/api/remote-access', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ listenOnNetwork: true }) })).status).toBe(401);
  });
});
