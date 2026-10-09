import { describe, expect, test } from 'bun:test';
import {
  checkRequestOrigin,
  guardRequestOrigin,
  isLoopbackAddress,
  isLoopbackHostname,
  type RequestOriginInput,
} from '@/transport/http/middleware/request-origin';

const local = (overrides: Partial<RequestOriginInput> = {}): RequestOriginInput => ({
  method: 'GET',
  host: 'localhost:8742',
  origin: null,
  peerAddress: '127.0.0.1',
  hasValidCredential: false,
  hasPreflightHeader: false,
  ...overrides,
});

describe('loopback helpers', () => {
  test('recognizes loopback addresses including IPv4-mapped IPv6', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.8.9.10')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.168.1.5')).toBe(false);
    expect(isLoopbackAddress('127.example.com')).toBe(false);
  });

  test('recognizes loopback hostnames', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('LOCALHOST.')).toBe(true);
    expect(isLoopbackHostname('app.localhost')).toBe(true);
    expect(isLoopbackHostname('[::1]')).toBe(true);
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('localhost.evil.com')).toBe(false);
    expect(isLoopbackHostname('evil.com')).toBe(false);
  });
});

describe('checkRequestOrigin', () => {
  test('allows same-machine clients without an Origin (CLI, desktop, extension workers)', () => {
    expect(checkRequestOrigin(local())).toEqual({ allowed: true });
    expect(checkRequestOrigin(local({ host: '127.0.0.1:8742' }))).toEqual({ allowed: true });
    expect(checkRequestOrigin(local({ host: '[::1]:8742', peerAddress: '::1' }))).toEqual({ allowed: true });
  });

  test('allows the embedded client and loopback dev servers', () => {
    expect(checkRequestOrigin(local({ origin: 'http://localhost:8742' }))).toEqual({ allowed: true });
    expect(checkRequestOrigin(local({ origin: 'http://localhost:5173' }))).toEqual({ allowed: true });
    expect(checkRequestOrigin(local({ origin: 'http://127.0.0.1:3000' }))).toEqual({ allowed: true });
  });

  test('allows browser extension origins', () => {
    expect(checkRequestOrigin(local({ origin: 'chrome-extension://abcdef' }))).toEqual({ allowed: true });
    expect(checkRequestOrigin(local({ origin: 'moz-extension://abcdef' }))).toEqual({ allowed: true });
  });

  test('refuses other websites calling the local server', () => {
    expect(checkRequestOrigin(local({ method: 'POST', origin: 'https://evil.com' })))
      .toEqual({ allowed: false, reason: 'foreign-origin' });
    expect(checkRequestOrigin(local({ origin: 'null' })))
      .toEqual({ allowed: false, reason: 'foreign-origin' });
    expect(checkRequestOrigin(local({ origin: 'file://' })))
      .toEqual({ allowed: false, reason: 'foreign-origin' });
  });

  test('refuses DNS-rebinding requests that reach loopback through a foreign Host', () => {
    expect(checkRequestOrigin(local({ host: 'evil.com:8742', origin: 'http://evil.com:8742' })))
      .toEqual({ allowed: false, reason: 'foreign-host' });
    expect(checkRequestOrigin(local({ host: 'evil.com:8742' })))
      .toEqual({ allowed: false, reason: 'foreign-host' });
    expect(checkRequestOrigin(local({ host: null })))
      .toEqual({ allowed: false, reason: 'foreign-host' });
  });

  test('a same-machine proxy may forward a published hostname (tailscale serve, Caddy)', () => {
    const known = (hostname: string) => hostname === 'studio.tail1234.ts.net';
    const proxied = local({ host: 'studio.tail1234.ts.net', origin: 'https://studio.tail1234.ts.net', isKnownHostname: known });
    expect(checkRequestOrigin(proxied)).toEqual({ allowed: true });
    expect(checkRequestOrigin({ ...proxied, host: 'evil.com', origin: 'http://evil.com' }))
      .toEqual({ allowed: false, reason: 'foreign-host' });
    expect(checkRequestOrigin({ ...proxied, origin: 'https://evil.com' }))
      .toEqual({ allowed: false, reason: 'foreign-origin' });
  });

  test('lets network clients use their own host name once the server is shared', () => {
    const lan = local({ peerAddress: '192.168.1.20', host: '192.168.1.5:8742' });
    expect(checkRequestOrigin(lan)).toEqual({ allowed: true });
    expect(checkRequestOrigin({ ...lan, origin: 'http://192.168.1.5:8742' })).toEqual({ allowed: true });
    expect(checkRequestOrigin({ ...lan, origin: 'https://evil.com' }))
      .toEqual({ allowed: false, reason: 'foreign-origin' });
  });

  test('valid credentials and CORS preflights skip the checks', () => {
    const foreign = local({ host: 'proxy.example.com', origin: 'https://other.example.com' });
    expect(checkRequestOrigin({ ...foreign, hasValidCredential: true })).toEqual({ allowed: true });
    expect(checkRequestOrigin({ ...foreign, method: 'OPTIONS', hasPreflightHeader: true })).toEqual({ allowed: true });
    expect(checkRequestOrigin({ ...foreign, method: 'OPTIONS' }))
      .toEqual({ allowed: false, reason: 'foreign-host' });
  });
});

describe('guardRequestOrigin', () => {
  test('returns null for allowed requests', () => {
    const req = new Request('http://localhost:8742/api/sessions', { headers: { Host: 'localhost:8742', Origin: 'http://localhost:8742' } });
    expect(guardRequestOrigin(req, '127.0.0.1', false)).toBeNull();
  });

  test('returns 403 with a reason for refused requests', async () => {
    const req = new Request('http://localhost:8742/api/sessions', {
      method: 'POST',
      headers: { Host: 'localhost:8742', Origin: 'https://evil.com' },
    });
    const res = guardRequestOrigin(req, '127.0.0.1', false);
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ reason: 'foreign-origin' });
  });

  test('lets authenticated requests through from any host and origin', () => {
    const req = new Request('http://proxy.example.com/api/sessions', {
      headers: { Host: 'proxy.example.com', Origin: 'https://other.example.com' },
    });
    expect(guardRequestOrigin(req, '127.0.0.1', true)).toBeNull();
    expect(guardRequestOrigin(req, '127.0.0.1', false)?.status).toBe(403);
  });
});

describe('cross-origin calls from a client served by another machine', () => {
  test('only routes that grant nothing by themselves are open to other origins', () => {
    const fromOtherMachine = (method: string, path: string) => guardRequestOrigin(
      new Request(`http://192.168.1.5:8742${path}`, { method, headers: { Host: '192.168.1.5:8742', Origin: 'http://10.0.0.9:8742' } }),
      '10.0.0.9',
      false,
    );
    expect(fromOtherMachine('GET', '/api/info')).toBeNull();
    expect(fromOtherMachine('GET', '/api/auth/status')).toBeNull();
    expect(fromOtherMachine('POST', '/api/auth/pair')).toBeNull();
    expect(fromOtherMachine('POST', '/api/auth/requests')?.status).toBe(403);
    expect(fromOtherMachine('GET', '/api/sessions')?.status).toBe(403);
  });

  test('refusals are readable by the other origin so it can offer pairing', async () => {
    const refused = guardRequestOrigin(
      new Request('http://192.168.1.5:8742/api/sessions', { headers: { Host: '192.168.1.5:8742', Origin: 'http://10.0.0.9:8742' } }),
      '10.0.0.9',
      false,
    )!;
    expect(refused.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await refused.json()).toMatchObject({ reason: 'foreign-origin' });
  });

  test('the DNS-rebinding host check still applies to open routes', () => {
    const rebinding = guardRequestOrigin(
      new Request('http://evil.com:8742/api/info', { headers: { Host: 'evil.com:8742', Origin: 'http://evil.com:8742' } }),
      '127.0.0.1',
      false,
    );
    expect(rebinding?.status).toBe(403);
  });
});

describe('guardRequestOrigin over a real Bun listener', () => {
  test('uses the socket peer address and Host header Bun provides', async () => {
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req, srv) {
        return guardRequestOrigin(req, srv.requestIP(req)?.address ?? null, false)
          ?? new Response('ok');
      },
    });
    try {
      const base = `http://127.0.0.1:${server.port}/api/sessions`;
      expect((await fetch(base)).status).toBe(200);
      expect((await fetch(base, { headers: { Origin: 'https://evil.com' } })).status).toBe(403);
      expect((await fetch(base, { headers: { Host: 'evil.com' } })).status).toBe(403);
    } finally {
      server.stop(true);
    }
  });
});
