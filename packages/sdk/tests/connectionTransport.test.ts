import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { WebSocketTransport } from '../src/transport/websocket';
import { HttpClient } from '../src/transport/http';

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sent: string[] = [];
  constructor() { FakeSocket.instances.push(this); }
  close(): void { this.readyState = 3; }
  send(value: string): void { this.sent.push(value); }
  open(): void { this.readyState = 1; this.onopen?.(); }
}

const transports: WebSocketTransport[] = [];
function transport(timeout = 1000): WebSocketTransport {
  const value = new WebSocketTransport({
    url: 'http://test',
    wsConstructor: FakeSocket as unknown as typeof WebSocket,
    connectionTimeout: timeout,
  });
  transports.push(value);
  return value;
}
const latest = () => FakeSocket.instances.at(-1)!;

afterEach(() => {
  for (const value of transports.splice(0)) value.dispose();
  FakeSocket.instances = [];
});

describe('connection transport', () => {
  test('timeout settles without waiting for a close event', async () => {
    const value = transport(5);
    let closed = 0;
    value.onClose = () => closed++;
    await expect(value.connect()).rejects.toThrow('Connection timeout');
    expect(value.connected).toBe(false);
    expect(closed).toBe(1);
  });

  test('retired callbacks cannot close or open a replacement socket', async () => {
    const value = transport();
    const first = value.connect().catch(error => error);
    const old = latest();
    const lateOpen = old.onopen!;
    const lateClose = old.onclose!;
    const second = value.connect();
    latest().open();
    await second;
    lateOpen();
    lateClose({ code: 1006, reason: '', wasClean: false } as CloseEvent);
    expect(value.connected).toBe(true);
    expect(await first).toBeInstanceOf(Error);
  });

  test('dispose settles pending connection without notifying listeners', async () => {
    const value = transport();
    let closed = 0;
    value.onClose = () => closed++;
    const pending = value.connect().catch(error => error);
    value.dispose();
    expect(await pending).toBeInstanceOf(Error);
    expect(closed).toBe(0);
    expect(latest().onopen).toBeNull();
  });

  test('foreground freshness uses elapsed time and messages refresh the deadline', async () => {
    const now = spyOn(Date, 'now');
    try {
      now.mockReturnValue(0);
      const value = transport();
      const pending = value.connect();
      latest().open();
      await pending;
      now.mockReturnValue(80_000);
      expect(value.checkConnectionFreshness()).toBe(true);
      latest().onmessage?.({ data: '{"type":"ping"}' } as MessageEvent);
      expect(latest().sent).toEqual(['{"type":"pong"}']);
      now.mockReturnValue(160_000);
      expect(value.checkConnectionFreshness()).toBe(true);
      now.mockReturnValue(170_000);
      expect(value.checkConnectionFreshness()).toBe(false);
      expect(value.ws).toBeNull();
    } finally {
      now.mockRestore();
    }
  });
});

describe('auth verification', () => {
  test('only 401 means invalid credentials, temporary errors reject', async () => {
    const fetch = spyOn(globalThis, 'fetch');
    try {
      fetch.mockResolvedValue(new Response('', { status: 200 }));
      expect(await HttpClient.verifyToken('http://test')).toBe(true);
      fetch.mockResolvedValue(new Response('', { status: 401 }));
      expect(await HttpClient.verifyToken('http://test')).toBe(false);
      for (const status of [429, 502, 503]) {
        fetch.mockResolvedValue(new Response('', { status }));
        await expect(HttpClient.verifyToken('http://test')).rejects.toThrow(`HTTP ${status}`);
      }
    } finally {
      fetch.mockRestore();
    }
  });

  test('verification is bounded and propagates caller cancellation', async () => {
    const fetch = spyOn(globalThis, 'fetch');
    try {
      fetch.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
        const signal = init!.signal!;
        if (signal.aborted) reject(new Error('aborted'));
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }));
      await expect(HttpClient.verifyToken('http://test', undefined, { timeoutMs: 5 })).rejects.toThrow('aborted');
      const controller = new AbortController();
      const pending = HttpClient.verifyToken('http://test', undefined, { signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toThrow('aborted');
    } finally {
      fetch.mockRestore();
    }
  });
});
