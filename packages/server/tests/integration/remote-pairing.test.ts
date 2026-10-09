import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { networkInterfaces } from 'node:os';

import { createWiredApplication } from '@/bootstrap/application';
import { createApp } from '@/transport/http/app';
import { createRemoteAccessService, type RemoteAccessService } from '@/application/remote-access/service';
import type { ListenerControl } from '@/application/ports/remote-access';
import { createRemoteAccessSettingsRepository } from '@/infrastructure/sqlite/remote-access-settings';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { buildPairingUrl } from '@/infrastructure/runtime/pairing-urls';
import { createBunWebSocketAdapter } from '@/transport/websocket/bun-adapter';
import { createListenerSet, type ListenerSet } from '@/transport/listeners';
import { createRequestHandler } from '@/transport/request-handler';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';

/**
 * End to end through real Bun listeners, the production request handler, the
 * HTTP app, device access, and remote access. Requests that carry
 * `Host: studio.ts.net` over loopback are what `tailscale serve` (or any
 * same-machine proxy) sends.
 */

const TAILNET_HOST = 'studio.tail1234.ts.net';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

function lanAddress(): string | null {
  return Object.values(networkInterfaces()).flat()
    .find((entry) => entry && !entry.internal && entry.family === 'IPv4' && !entry.address.startsWith('169.254.'))?.address ?? null;
}

describe('remote pairing end to end', () => {
  let port: number;
  let listeners: ListenerSet;
  let remoteAccess: RemoteAccessService;
  let wired: ReturnType<typeof createWiredApplication>;

  const local = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, init);
  const viaProxy = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { ...(init.headers ?? {}), Host: TAILNET_HOST } });

  beforeEach(() => {
    setupTestDataDir();
    setupTestDatabase();
    port = freePort();
    wired = createWiredApplication();
    const transport = createBunWebSocketAdapter({
      terminal: { getManager: () => ({}) as never, getEventManager: () => ({}) as never },
      resolveAskTargets: () => [],
    });
    wired.deviceAccess.subscribe({ deviceRevoked: (id) => transport.closeDeviceSockets(id) });

    const control: ListenerControl = {
      endpoint: () => ({ host: listeners.main()?.hostname ?? '127.0.0.1', port, protocol: 'http' }),
      loopbackTarget: () => `http://127.0.0.1:${port}`,
      rebind: async (host) => listeners.rebindMain({ hostname: host, port }),
    };
    remoteAccess = createRemoteAccessService({
      repository: createRemoteAccessSettingsRepository(getDatabase),
      network: {
        interfaces: () => Object.entries(networkInterfaces()).flatMap(([interfaceName, entries]) =>
          (entries ?? []).filter((entry) => !entry.internal)
            .map((entry) => ({ interfaceName, address: entry.address, family: entry.family === 'IPv6' ? 'IPv6' as const : 'IPv4' as const }))),
        tailscale: async () => null,
        setTailscaleServe: async () => {},
      },
      environment: { bindOverride: null, extraHosts: [] },
      listeners: () => control,
      onNetworkListeningDisabled: () => transport.closeNetworkSockets(),
    });
    const app = createApp(wired, {
      remoteAccess,
      pairingLinks: (code) => remoteAccess.pairingBaseUrls().map((url) => buildPairingUrl(url, code)),
    });
    const handleRequest = createRequestHandler({
      app,
      transport,
      deviceAccess: wired.deviceAccess,
      validateLegacyToken: () => false,
      isAuthDisabled: () => false,
      isKnownHostname: (hostname) => remoteAccess.isKnownHostname(hostname),
    });
    listeners = createListenerSet({ fetch: handleRequest, websocket: transport.websocket });
    listeners.start({ hostname: remoteAccess.bindHost(), port }, null);
  });

  afterEach(() => {
    listeners.stop();
    wired.deviceAccess.dispose();
    resetTestDatabase();
    resetTestDataDir();
  });

  test('this machine needs no login', async () => {
    expect((await local('/api/sessions')).status).toBe(200);
    expect(await (await local('/api/auth/status')).json()).toMatchObject({ paired: true, access: 'local', admin: true });
  });

  test('an unknown proxy hostname is refused; a published one requires pairing', async () => {
    const refused = await viaProxy('/api/auth/status');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ reason: 'foreign-host', message: expect.stringContaining('prokop remote add') });

    await local('/api/remote-access/addresses', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ url: TAILNET_HOST }) });

    expect(await (await viaProxy('/api/auth/status')).json()).toMatchObject({ paired: false });
    expect((await viaProxy('/api/sessions')).status).toBe(401);
    expect((await viaProxy('/api/remote-access')).status).toBe(401);
  });

  test('a device behind the proxy is approved, uses a socket ticket, and is cut off on revoke', async () => {
    await remoteAccess.addAddress(`https://${TAILNET_HOST}`);

    const created = await viaProxy('/api/auth/requests', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ label: 'iPhone (Safari)', deviceKind: 'mobile' }),
    });
    expect(created.status).toBe(201);
    const request = await created.json() as { requestId: string; secret: string };

    const stream = await viaProxy(`/api/auth/requests/${request.requestId}/events?secret=${request.secret}`);
    const decision = stream.text();
    expect((await local(`/api/auth/requests/${request.requestId}/approve`, { method: 'POST' })).status).toBe(200);
    const data = (await decision).split('\n').find((line) => line.startsWith('data: '))!.slice(6);
    const { token } = JSON.parse(data) as { token: string };

    const authorized = { Authorization: `Bearer ${token}` };
    expect((await viaProxy('/api/sessions', { headers: authorized })).status).toBe(200);
    expect((await viaProxy('/api/auth/access', { headers: authorized })).status).toBe(403);

    const { ticket } = await (await viaProxy('/api/auth/ws-ticket', { method: 'POST', headers: authorized })).json() as { ticket: string };
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket}`, { headers: { Host: TAILNET_HOST } } as never);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const closed = new Promise<number>((resolve) => { socket.onclose = (event) => resolve(event.code); });

    const reused = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket}`, { headers: { Host: TAILNET_HOST } } as never);
    const reuse = await new Promise<string>((resolve) => {
      reused.onopen = () => resolve('open');
      reused.onerror = () => resolve('refused');
    });
    expect(reuse).toBe('refused');

    const status = await (await viaProxy('/api/auth/status', { headers: authorized })).json() as { device: { id: string } };
    expect((await local(`/api/auth/devices/${status.device.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await closed).toBe(4401);
    expect((await viaProxy('/api/sessions', { headers: authorized })).status).toBe(401);
  });

  test('a client served by another machine can probe and pair with a code, but not raise approval prompts', async () => {
    const otherOrigin = { Origin: 'http://10.0.0.9:8742', Host: TAILNET_HOST };
    await remoteAccess.addAddress(`https://${TAILNET_HOST}`);

    const info = await local('/api/info', { headers: otherOrigin });
    expect(info.status).toBe(200);
    expect(info.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const prompt = await local('/api/auth/requests', {
      method: 'POST', headers: { ...otherOrigin, ...JSON_HEADERS }, body: JSON.stringify({ label: 'Hostile site' }),
    });
    expect(prompt.status).toBe(403);
    expect(await prompt.json()).toMatchObject({ reason: 'foreign-origin' });

    const { code } = await (await local('/api/auth/pairing-codes', { method: 'POST', headers: JSON_HEADERS, body: '{}' })).json() as { code: string };
    const paired = await local('/api/auth/pair', {
      method: 'POST', headers: { ...otherOrigin, ...JSON_HEADERS }, body: JSON.stringify({ code, label: 'Phone' }),
    });
    expect(paired.status).toBe(200);
    const { token } = await paired.json() as { token: string };
    expect((await local('/api/workspaces', { headers: { ...otherOrigin, Authorization: `Bearer ${token}` } })).status).toBe(200);
  });

  test('turning network listening on re-binds in place and other devices must pair', async () => {
    const lan = lanAddress();
    const keepAlive = await local('/api/sessions');
    expect(keepAlive.status).toBe(200);

    const on = await local('/api/remote-access', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ listenOnNetwork: true }) });
    expect(await on.json()).toMatchObject({ listenOnNetwork: true, bindHost: '0.0.0.0' });
    expect(listeners.main()).toEqual({ hostname: '0.0.0.0', port });
    expect((await local('/api/sessions')).status).toBe(200);

    const code = await (await local('/api/auth/pairing-codes', { method: 'POST', headers: JSON_HEADERS, body: '{}' })).json() as { links: string[] };
    if (lan) {
      expect(code.links).toContainEqual(expect.stringContaining(`http://${lan}:${port}/pair#code=`));
      // Another device's view: a non-loopback peer.
      expect((await fetch(`http://${lan}:${port}/api/sessions`)).status).toBe(401);
    }

    await local('/api/remote-access', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ listenOnNetwork: false }) });
    expect(listeners.main()).toEqual({ hostname: '127.0.0.1', port });
    if (lan) {
      await expect(fetch(`http://${lan}:${port}/api/sessions`)).rejects.toThrow();
    }
    expect((await local('/api/sessions')).status).toBe(200);
  });
});
