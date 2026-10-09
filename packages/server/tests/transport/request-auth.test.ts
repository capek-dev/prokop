import { describe, expect, test } from 'bun:test';
import type { AccessPrincipal } from '@/application/device-access/service';
import {
  readRequestAuthInput,
  resolveRequestPrincipal,
  type RequestAuthDeps,
  type RequestAuthInput,
} from '@/transport/http/request-auth';

const PHONE: AccessPrincipal = { kind: 'device', deviceId: 'phone', label: 'Phone' };

function deps(overrides: Partial<RequestAuthDeps> = {}): RequestAuthDeps {
  return {
    deviceAccess: {
      authenticate: (token) => (token === 'pkd_phone' ? PHONE : null),
      redeemSocketTicket: (ticket) => (ticket === 'ticket-phone' ? PHONE : null),
    },
    validateLegacyToken: (token) => token === 'shared-secret',
    isAuthDisabled: () => false,
    ...overrides,
  };
}

function input(overrides: Partial<RequestAuthInput> = {}): RequestAuthInput {
  return {
    peerAddress: '192.168.1.20',
    host: '192.168.1.5:8742',
    bearer: null,
    queryToken: null,
    socketTicket: null,
    ...overrides,
  };
}

describe('resolveRequestPrincipal', () => {
  test('the same machine needs no credential', () => {
    expect(resolveRequestPrincipal(input({ peerAddress: '127.0.0.1', host: 'localhost:8742' }), deps()))
      .toEqual({ kind: 'local' });
    expect(resolveRequestPrincipal(input({ peerAddress: null, host: 'localhost' }), deps()))
      .toEqual({ kind: 'local' });
  });

  test('another device without a credential is not authorized', () => {
    expect(resolveRequestPrincipal(input(), deps())).toBeNull();
    // A proxy on the same machine forwards a non-loopback Host.
    expect(resolveRequestPrincipal(input({ peerAddress: '127.0.0.1', host: 'box.tailnet.ts.net' }), deps())).toBeNull();
  });

  test('paired devices authenticate with a bearer token, not a URL token', () => {
    expect(resolveRequestPrincipal(input({ bearer: 'pkd_phone' }), deps())).toEqual(PHONE);
    expect(resolveRequestPrincipal(input({ queryToken: 'pkd_phone' }), deps())).toBeNull();
  });

  test('the shared legacy token works from the header or URL', () => {
    expect(resolveRequestPrincipal(input({ bearer: 'shared-secret' }), deps())).toEqual({ kind: 'token' });
    expect(resolveRequestPrincipal(input({ queryToken: 'shared-secret' }), deps())).toEqual({ kind: 'token' });
  });

  test('socket tickets identify the device that minted them', () => {
    expect(resolveRequestPrincipal(input({ socketTicket: 'ticket-phone' }), deps())).toEqual(PHONE);
    expect(resolveRequestPrincipal(input({ socketTicket: 'stale' }), deps())).toBeNull();
  });

  test('a paired device on loopback is still identified as that device', () => {
    expect(resolveRequestPrincipal(input({ peerAddress: '127.0.0.1', host: 'localhost', bearer: 'pkd_phone' }), deps()))
      .toEqual(PHONE);
  });

  test('a stale credential from the same machine falls back to same-machine trust', () => {
    expect(resolveRequestPrincipal(input({ peerAddress: '127.0.0.1', host: 'localhost', bearer: 'pkd_revoked' }), deps()))
      .toEqual({ kind: 'local' });
  });

  test('PROKOPAI_AUTH=off trusts other devices', () => {
    expect(resolveRequestPrincipal(input(), deps({ isAuthDisabled: () => true }))).toEqual({ kind: 'open' });
  });
});

describe('readRequestAuthInput', () => {
  test('reads bearer, URL token, and ticket only when allowed', () => {
    const req = new Request('http://localhost:8742/ws?ticket=t1&token=q1', {
      headers: { Host: 'localhost:8742', Authorization: 'Bearer b1' },
    });
    expect(readRequestAuthInput(req, '127.0.0.1', true)).toEqual({
      peerAddress: '127.0.0.1',
      host: 'localhost:8742',
      bearer: 'b1',
      queryToken: 'q1',
      socketTicket: 't1',
    });
    expect(readRequestAuthInput(req, '127.0.0.1', false).socketTicket).toBeNull();
  });
});
