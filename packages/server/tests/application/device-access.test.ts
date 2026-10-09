import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  createDeviceAccessService,
  formatPairingCode,
  normalizePairingCode,
  type DeviceAccessService,
} from '@/application/device-access/service';
import { createDeviceAccessRepository, initializeDeviceAccessSchema } from '@/infrastructure/sqlite/device-access';

describe('device access service', () => {
  let db: Database;
  let clock: number;
  let service: DeviceAccessService;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeDeviceAccessSchema(db);
    clock = 1_000_000;
    service = createDeviceAccessService({ repository: createDeviceAccessRepository(() => db), now: () => clock });
  });

  afterEach(() => {
    service.dispose();
    db.close();
  });

  test('pairing codes normalize typed input and format in groups', () => {
    expect(normalizePairingCode(' abcd-efgh 2345 ')).toBe('ABCDEFGH2345');
    expect(formatPairingCode('ABCDEFGH2345')).toBe('ABCD-EFGH-2345');
  });

  test('a pairing code issues one device token and cannot be reused', () => {
    const { code } = service.createPairingCode({ label: 'From QR' });
    expect(code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);

    const issued = service.redeemPairingCode({ code: code.toLowerCase(), label: 'Phone', deviceKind: 'mobile' });
    expect(issued?.token.startsWith('pkd_')).toBe(true);
    expect(issued?.device).toMatchObject({ label: 'Phone', deviceKind: 'mobile' });
    expect(service.redeemPairingCode({ code, label: 'Phone', deviceKind: 'mobile' })).toBeNull();

    expect(service.authenticate(issued!.token)).toEqual({ kind: 'device', deviceId: issued!.device.id, label: 'Phone' });
    expect(service.authenticate('pkd_unknown')).toBeNull();
    expect(service.authenticate('not-a-device-token')).toBeNull();
  });

  test('stores only hashes of codes and tokens', () => {
    const { code } = service.createPairingCode({});
    const issued = service.redeemPairingCode({ code, label: '', deviceKind: 'unknown' })!;
    const dump = JSON.stringify([
      db.query('SELECT * FROM auth_pairing_codes').all(),
      db.query('SELECT * FROM auth_device_sessions').all(),
    ]);
    expect(dump).not.toContain(normalizePairingCode(code));
    expect(dump).not.toContain(issued.token);
    expect(issued.device.label).toBe('Unnamed device');
  });

  test('expired pairing codes and sessions are refused', () => {
    const { code } = service.createPairingCode({});
    clock += 5 * 60 * 1000;
    expect(service.redeemPairingCode({ code, label: 'Late', deviceKind: 'unknown' })).toBeNull();

    const fresh = service.createPairingCode({});
    const issued = service.redeemPairingCode({ code: fresh.code, label: 'Phone', deviceKind: 'mobile' })!;
    clock += 30 * 24 * 60 * 60 * 1000;
    expect(service.authenticate(issued.token)).toBeNull();
  });

  test('use slides the session expiry forward', () => {
    const { code } = service.createPairingCode({});
    const issued = service.redeemPairingCode({ code, label: 'Phone', deviceKind: 'mobile' })!;
    clock += 20 * 24 * 60 * 60 * 1000;
    expect(service.authenticate(issued.token)).not.toBeNull();
    clock += 20 * 24 * 60 * 60 * 1000;
    expect(service.authenticate(issued.token)).not.toBeNull();
  });

  test('approval request delivers a token to the waiting device', async () => {
    const changes: string[] = [];
    service.subscribe({ changed: () => changes.push('changed') });
    const request = service.requestAccess({ label: 'iPhone (Safari)', deviceKind: 'mobile' })!;
    expect(request.matchCode).toMatch(/^\d{4}$/);
    expect(service.listAccessRequests()).toEqual([
      expect.objectContaining({ id: request.requestId, label: 'iPhone (Safari)', matchCode: request.matchCode }),
    ]);
    expect(service.waitForAccessDecision(request.requestId, 'wrong-secret')).toBeNull();

    const waiting = service.waitForAccessDecision(request.requestId, request.secret)!;
    expect(service.approveAccessRequest(request.requestId)).toBe(true);
    const outcome = await waiting;

    expect(outcome.status).toBe('approved');
    if (outcome.status === 'approved') {
      expect(service.authenticate(outcome.token)).toMatchObject({ kind: 'device', label: 'iPhone (Safari)' });
    }
    expect(service.listAccessRequests()).toEqual([]);
    expect(service.approveAccessRequest(request.requestId)).toBe(false);
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });

  test('a device that reconnects after approval still receives its token once', async () => {
    const request = service.requestAccess({ label: 'Tablet', deviceKind: 'tablet' })!;
    const dropped = new AbortController();
    void service.waitForAccessDecision(request.requestId, request.secret, dropped.signal);
    dropped.abort();

    service.approveAccessRequest(request.requestId);
    const outcome = await service.waitForAccessDecision(request.requestId, request.secret)!;
    expect(outcome.status).toBe('approved');
    expect(service.waitForAccessDecision(request.requestId, request.secret)).toBeNull();
  });

  test('denied and expired requests resolve without a token', async () => {
    const denied = service.requestAccess({ label: 'Unknown', deviceKind: 'unknown' })!;
    const waiting = service.waitForAccessDecision(denied.requestId, denied.secret)!;
    service.denyAccessRequest(denied.requestId);
    expect(await waiting).toEqual({ status: 'denied' });

    const short = createDeviceAccessService({
      repository: createDeviceAccessRepository(() => db),
      accessRequestTtlMs: 5,
    });
    const expiring = short.requestAccess({ label: 'Slow', deviceKind: 'unknown' })!;
    expect(await short.waitForAccessDecision(expiring.requestId, expiring.secret)!).toEqual({ status: 'expired' });
    expect(short.listAccessRequests()).toEqual([]);
    short.dispose();
  });

  test('limits how many devices can wait for approval at once', () => {
    const limited = createDeviceAccessService({ repository: createDeviceAccessRepository(() => db), maxPendingRequests: 2 });
    expect(limited.requestAccess({ label: 'A', deviceKind: 'unknown' })).not.toBeNull();
    expect(limited.requestAccess({ label: 'B', deviceKind: 'unknown' })).not.toBeNull();
    expect(limited.requestAccess({ label: 'C', deviceKind: 'unknown' })).toBeNull();
    limited.dispose();
  });

  test('revoking a device rejects its token and tickets and notifies listeners', () => {
    const revoked: string[] = [];
    service.subscribe({ deviceRevoked: (id) => revoked.push(id) });
    const { code } = service.createPairingCode({});
    const issued = service.redeemPairingCode({ code, label: 'Phone', deviceKind: 'mobile' })!;
    const principal = service.authenticate(issued.token)!;
    const { ticket } = service.issueSocketTicket(principal);

    expect(service.listDevices().map((device) => device.id)).toEqual([issued.device.id]);
    expect(service.revokeDevice(issued.device.id)).toBe(true);
    expect(service.revokeDevice(issued.device.id)).toBe(false);

    expect(revoked).toEqual([issued.device.id]);
    expect(service.authenticate(issued.token)).toBeNull();
    expect(service.redeemSocketTicket(ticket)).toBeNull();
    expect(service.listDevices()).toEqual([]);
  });

  test('socket tickets are single use and expire', () => {
    const first = service.issueSocketTicket({ kind: 'local' });
    expect(service.redeemSocketTicket(first.ticket)).toEqual({ kind: 'local' });
    expect(service.redeemSocketTicket(first.ticket)).toBeNull();

    const second = service.issueSocketTicket({ kind: 'local' });
    clock += 60 * 1000;
    expect(service.redeemSocketTicket(second.ticket)).toBeNull();
  });
});
