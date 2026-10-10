import { describe, expect, mock, test } from 'bun:test';
import type { Server } from 'bun';
import { createRequestHandler } from '@/transport/request-handler';
import type { WsData } from '@/transport/websocket/bun-adapter';

/**
 * Bun closes a response body that stays silent for its idle timeout (10 s by
 * default). Event streams must opt out, or quiet attention and pairing streams
 * break mid-body and the browser reconnects in a loop.
 */
function setup() {
  const timeout = mock((_req: Request, _seconds: number) => {});
  const listener = {
    requestIP: () => ({ address: '127.0.0.1', family: 'IPv4', port: 1 }),
    upgrade: () => false,
    timeout,
  } as unknown as Server<WsData>;
  const handle = createRequestHandler({
    app: { fetch: () => new Response('ok') },
    transport: { handleUpgrade: () => ({ handled: false }) } as never,
    deviceAccess: { authenticate: () => null, redeemSocketTicket: () => null } as never,
    validateLegacyToken: () => false,
    isAuthDisabled: () => true,
    isKnownHostname: () => false,
  });
  return { handle, listener, timeout };
}

describe('request handler idle timeout', () => {
  test('event streams disable the idle timeout for that request only', async () => {
    const { handle, listener, timeout } = setup();
    const req = new Request('http://127.0.0.1/api/attention/events', { headers: { Host: '127.0.0.1:8742', Accept: 'text/event-stream' } });
    expect((await handle(req, listener))?.status).toBe(200);
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout.mock.calls[0]).toEqual([req, 0]);
  });

  test('Git mutations wait for Git instead of the idle timeout', async () => {
    const { handle, listener, timeout } = setup();
    const push = new Request('http://127.0.0.1/api/workspaces/ws-1/git/branch-action', { method: 'POST', headers: { Host: '127.0.0.1:8742' } });
    await handle(push, listener);
    await handle(new Request('http://127.0.0.1/api/workspaces/ws-1/git/branches', { headers: { Host: '127.0.0.1:8742' } }), listener);
    expect(timeout.mock.calls).toEqual([[push, 0]]);
  });

  test('ordinary requests keep the idle guard', async () => {
    const { handle, listener, timeout } = setup();
    const json = await handle(new Request('http://127.0.0.1/api/attention', { headers: { Host: '127.0.0.1:8742', Accept: 'application/json' } }), listener);
    const plain = await handle(new Request('http://127.0.0.1/api/health', { headers: { Host: '127.0.0.1:8742' } }), listener);
    expect([json?.status, plain?.status]).toEqual([200, 200]);
    expect(timeout).not.toHaveBeenCalled();
  });
});
