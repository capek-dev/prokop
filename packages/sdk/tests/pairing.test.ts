import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  PairingError,
  readPairingLink,
  requestDeviceAccess,
  socketAuthQuery,
  waitForAccessDecision,
} from '../src/pairing';
import { HttpClient } from '../src/transport/http';
import { AuthError } from '../src/errors';

const fetchSpies: Array<{ mockRestore(): void }> = [];

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = spyOn(globalThis, 'fetch').mockImplementation(
    ((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init))) as typeof fetch,
  );
  fetchSpies.push(spy);
  return spy;
}

afterEach(() => {
  for (const spy of fetchSpies.splice(0)) spy.mockRestore();
});

describe('readPairingLink', () => {
  test('reads the server origin and the code from the fragment', () => {
    expect(readPairingLink('http://192.168.1.5:8742/pair#code=ABCD-EFGH-2345')).toEqual({
      serverUrl: 'http://192.168.1.5:8742',
      code: 'ABCD-EFGH-2345',
    });
  });

  test('ignores links without a fragment code or with other schemes', () => {
    expect(readPairingLink('http://192.168.1.5:8742/pair?code=ABCD')).toBeNull();
    expect(readPairingLink('file:///pair#code=ABCD')).toBeNull();
    expect(readPairingLink('not a url')).toBeNull();
  });
});

describe('waitForAccessDecision', () => {
  test('returns the decision event and skips keepalive comments', async () => {
    const outcome = { status: 'approved', token: 'pkd_x', device: { id: 'd1' } };
    const chunks = [': keepalive\n\n', 'event: decision\ndata: ', `${JSON.stringify(outcome)}\n\n`];
    const spy = mockFetch(() => new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } }));

    const decision = await waitForAccessDecision('http://host:8742', { requestId: 'r 1', secret: 's/1' });
    expect(decision).toEqual(outcome as never);
    expect(String(spy.mock.calls[0]![0])).toBe('http://host:8742/api/auth/requests/r%201/events?secret=s%2F1');
  });

  test('rejects for an unknown request and when the stream ends without a decision', async () => {
    mockFetch(() => Response.json({ error: 'not_found', message: 'gone' }, { status: 404 }));
    await expect(waitForAccessDecision('http://host:8742', { requestId: 'r', secret: 's' }))
      .rejects.toBeInstanceOf(PairingError);

    fetchSpies.splice(0).forEach((spy) => spy.mockRestore());
    mockFetch(() => new Response(': keepalive\n\n'));
    await expect(waitForAccessDecision('http://host:8742', { requestId: 'r', secret: 's' }))
      .rejects.toMatchObject({ code: 'stream_closed' });
  });
});

describe('socketAuthQuery', () => {
  test('needs nothing without a token', async () => {
    const spy = mockFetch(() => new Response());
    expect(await socketAuthQuery('http://host:8742', undefined)).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  test('exchanges the token for a ticket', async () => {
    const spy = mockFetch(() => Response.json({ ticket: 't1', expiresAt: 1 }));
    expect(await socketAuthQuery('http://host:8742', 'pkd_x')).toEqual({ ticket: 't1' });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://host:8742/api/auth/ws-ticket');
    expect(init?.headers).toEqual({ Authorization: 'Bearer pkd_x' });
  });

  test('falls back to the URL token on servers without tickets', async () => {
    mockFetch(() => new Response('Not found', { status: 404 }));
    expect(await socketAuthQuery('http://host:8742', 'legacy')).toEqual({ token: 'legacy' });
  });

  test('surfaces a revoked device as an error', async () => {
    mockFetch(() => Response.json({ error: 'Unauthorized' }, { status: 401 }));
    await expect(socketAuthQuery('http://host:8742', 'pkd_revoked')).rejects.toMatchObject({ status: 401 });
  });
});

describe('calls from a client served by another machine', () => {
  test('a cross-site refusal means this device must pair', async () => {
    mockFetch(() => Response.json({ error: 'Forbidden', reason: 'foreign-origin', message: 'Requests from other websites are not allowed.' }, { status: 403 }));
    await expect(new HttpClient({ url: 'http://host:8742' }).get('/workspaces')).rejects.toBeInstanceOf(AuthError);
  });

  test('other 403s stay ordinary errors', async () => {
    mockFetch(() => Response.json({ error: 'Forbidden', message: 'Only the server machine can do that.' }, { status: 403 }));
    await expect(new HttpClient({ url: 'http://host:8742' }).get('/auth/access')).rejects.not.toBeInstanceOf(AuthError);
  });

  test('pairing errors carry the refusal reason', async () => {
    mockFetch(() => Response.json({ error: 'Forbidden', reason: 'foreign-origin', message: 'nope' }, { status: 403 }));
    await expect(requestDeviceAccess('http://host:8742', { label: 'x', deviceKind: 'unknown' }))
      .rejects.toMatchObject({ code: 'foreign-origin', status: 403 });
  });
});
