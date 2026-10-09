import { describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import { createListenerSet } from '@/transport/listeners';
import type { WsData } from '@/transport/websocket/bun-adapter';

function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

function makeSet() {
  return createListenerSet({
    fetch: async (req: Request, server: Server<WsData>) => {
      if (server.upgrade(req, { data: { path: '/ws' } })) return undefined;
      return new Response(`listening on ${server.hostname}`);
    },
    websocket: {
      message(ws, message) {
        ws.send(`echo:${String(message)}`);
      },
    },
  });
}

describe('listener set', () => {
  test('re-binds the main listener in place without dropping open WebSockets', async () => {
    const port = freePort();
    const listeners = makeSet();
    listeners.start({ hostname: '127.0.0.1', port }, null);
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise((resolve) => { socket.onopen = resolve; });
      const replies: string[] = [];
      socket.onmessage = (event) => replies.push(String(event.data));

      listeners.rebindMain({ hostname: '0.0.0.0', port });
      expect(listeners.main()).toEqual({ hostname: '0.0.0.0', port });
      expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe('listening on 0.0.0.0');

      socket.send('still here');
      await Bun.sleep(100);
      expect(replies).toEqual(['echo:still here']);

      listeners.rebindMain({ hostname: '127.0.0.1', port });
      expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe('listening on 127.0.0.1');
      socket.close();
    } finally {
      listeners.stop();
    }
  });

  test('a failed re-bind restores the previous listener', () => {
    const port = freePort();
    const blocker = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
    const listeners = makeSet();
    listeners.start({ hostname: '127.0.0.1', port }, null);
    try {
      expect(() => listeners.rebindMain({ hostname: '127.0.0.1', port: blocker.port! })).toThrow();
      expect(listeners.main()).toEqual({ hostname: '127.0.0.1', port });
    } finally {
      listeners.stop();
      blocker.stop(true);
    }
  });

  test('re-binding to the same endpoint is a no-op', () => {
    const port = freePort();
    let serves = 0;
    const listeners = createListenerSet({
      fetch: async () => new Response(),
      websocket: { message() {} },
      serve: () => {
        serves++;
        return { stop: async () => {} } as unknown as Server<WsData>;
      },
    });
    listeners.start({ hostname: '127.0.0.1', port }, null);
    listeners.rebindMain({ hostname: '127.0.0.1', port });
    expect(serves).toBe(1);
  });
});
