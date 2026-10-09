import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createApp } from '@/transport/http/app';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';

const REMOTE_ORIGIN = 'http://prokop.example.com';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

describe('device access routes', () => {
  let app: ReturnType<typeof createApp>;

  /** Same machine: in-process request with a loopback Host. */
  const local = (path: string, init?: RequestInit) => app.request(path, init);
  /** Another device: non-loopback Host. */
  const remote = (path: string, init?: RequestInit) => app.request(`${REMOTE_ORIGIN}${path}`, init);
  const asDevice = (token: string, path: string, init: RequestInit = {}) =>
    remote(path, { ...init, headers: { ...JSON_HEADERS, ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });

  async function pairWithCode(label = 'Phone'): Promise<{ token: string; device: { id: string } }> {
    const created = await local('/api/auth/pairing-codes', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    expect(created.status).toBe(201);
    const { code } = await created.json() as { code: string };
    const paired = await remote('/api/auth/pair', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ code, label, deviceKind: 'mobile' }),
    });
    expect(paired.status).toBe(200);
    return paired.json() as Promise<{ token: string; device: { id: string } }>;
  }

  beforeEach(() => {
    setupTestDataDir();
    setupTestDatabase();
    app = createApp();
  });

  afterEach(() => {
    resetTestDatabase();
    resetTestDataDir();
  });

  test('status reports how the caller is authorized', async () => {
    expect(await (await local('/api/auth/status')).json()).toMatchObject({ paired: true, access: 'local', admin: true });
    expect(await (await remote('/api/auth/status')).json()).toMatchObject({ paired: false, access: null, admin: false });

    const { token, device } = await pairWithCode();
    expect(await (await asDevice(token, '/api/auth/status')).json()).toMatchObject({
      paired: true,
      access: 'device',
      admin: false,
      device: { id: device.id, label: 'Phone' },
    });
  });

  test('another device gets access after redeeming a pairing code', async () => {
    expect((await remote('/api/sessions')).status).toBe(401);
    const { token } = await pairWithCode();
    expect((await asDevice(token, '/api/sessions')).status).toBe(200);
  });

  test('pairing codes include links another device can open', async () => {
    app = createApp(undefined, { pairingLinks: (code) => [`http://192.168.1.5:8742/pair#code=${code}`] });
    const created = await local('/api/auth/pairing-codes', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    const body = await created.json() as { code: string; links: string[] };
    expect(body.links).toEqual([`http://192.168.1.5:8742/pair#code=${body.code}`]);

    app = createApp();
    const local2 = await local('/api/auth/pairing-codes', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    expect((await local2.json() as { links: string[] }).links).toEqual([]);
  });

  test('invalid pairing codes are rejected', async () => {
    const res = await remote('/api/auth/pair', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ code: 'AAAA-BBBB-CCCC', label: 'Phone' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_code' });
  });

  test('only the server machine manages access', async () => {
    const { token } = await pairWithCode();
    expect((await asDevice(token, '/api/auth/access')).status).toBe(403);
    expect((await asDevice(token, '/api/auth/pairing-codes', { method: 'POST', body: '{}' })).status).toBe(403);
    expect((await remote('/api/auth/pairing-codes', { method: 'POST', headers: JSON_HEADERS, body: '{}' })).status).toBe(401);
    expect((await local('/api/auth/access')).status).toBe(200);
  });

  test('approval streams the decision to the waiting device', async () => {
    const created = await remote('/api/auth/requests', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ label: 'iPhone (Safari)', deviceKind: 'mobile' }),
    });
    expect(created.status).toBe(201);
    const request = await created.json() as { requestId: string; secret: string; matchCode: string };

    const pending = await (await local('/api/auth/access')).json() as { requests: Array<{ id: string; matchCode: string }> };
    expect(pending.requests).toEqual([expect.objectContaining({ id: request.requestId, matchCode: request.matchCode })]);

    expect((await remote(`/api/auth/requests/${request.requestId}/events?secret=wrong`)).status).toBe(404);
    const events = await remote(`/api/auth/requests/${request.requestId}/events?secret=${request.secret}`);
    expect(events.status).toBe(200);
    expect(events.headers.get('Content-Type')).toContain('text/event-stream');

    expect((await local(`/api/auth/requests/${request.requestId}/approve`, { method: 'POST' })).status).toBe(200);
    const body = await events.text();
    const data = body.split('\n').find((line) => line.startsWith('data: '))!.slice('data: '.length);
    const outcome = JSON.parse(data) as { status: string; token: string };
    expect(body).toContain('event: decision');
    expect(outcome.status).toBe('approved');
    expect((await asDevice(outcome.token, '/api/sessions')).status).toBe(200);
  });

  test('revoking a device removes its access; a device may revoke itself', async () => {
    const phone = await pairWithCode('Phone');
    const tablet = await pairWithCode('Tablet');

    expect((await asDevice(phone.token, `/api/auth/devices/${tablet.device.id}`, { method: 'DELETE' })).status).toBe(403);
    expect((await local(`/api/auth/devices/${tablet.device.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await asDevice(tablet.token, '/api/sessions')).status).toBe(401);

    expect((await asDevice(phone.token, `/api/auth/devices/${phone.device.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await asDevice(phone.token, '/api/sessions')).status).toBe(401);
  });

  test('paired devices get socket tickets; unpaired callers do not', async () => {
    const { token } = await pairWithCode();
    const ticket = await asDevice(token, '/api/auth/ws-ticket', { method: 'POST' });
    expect(ticket.status).toBe(200);
    expect(await ticket.json()).toMatchObject({ ticket: expect.any(String), expiresAt: expect.any(Number) });
    expect((await remote('/api/auth/ws-ticket', { method: 'POST' })).status).toBe(401);
  });
});
