import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import type { TerminalSessionInfo } from '@jean2/sdk';
import { createBunWebSocketAdapter, type WsData } from '@/transport/websocket/bun-adapter';
import { decodeFrame, encodeFrame, OPCODES } from '@/transport/terminal';

function makeTerminalSocket(path: string, params?: Record<string, string>) {
  const sent: Uint8Array[] = [];
  const closed: boolean[] = [];
  const socket = {
    data: { path, params },
    sent,
    closed,
    send(data: string | Uint8Array) {
      sent.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
    },
    close() {
      closed.push(true);
    },
  } as unknown as ServerWebSocket<WsData>;
  return { socket, sent, closed };
}

describe('terminal frame adaptation', () => {
  test('frames encode and decode round trip with the opcode as the first byte', () => {
    const payload = new TextEncoder().encode(JSON.stringify({ message: 'hello' }));
    const frame = encodeFrame(OPCODES.ERROR, payload);

    expect(frame[0]).toBe(0x06);
    const decoded = decodeFrame(frame);
    expect(decoded.opcode).toBe(OPCODES.ERROR);
    expect(new TextDecoder().decode(decoded.payload)).toBe('{"message":"hello"}');
  });

  test('terminal open with a known session replays INIT_ACK and buffer', () => {
    const session: TerminalSessionInfo = {
      id: 'sess-1',
      pid: 1,
      shell: '/bin/bash',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      title: 'main',
      status: 'running',
      exitCode: null,
      createdAt: 1,
      lastActivityAt: 1,
      activeClientCount: 0,
      inAlternateScreen: false,
    };
    const calls: string[] = [];
    const adapter = createBunWebSocketAdapter({
      auth: { isAuthEnabled: () => false, validateToken: () => true },
      terminal: {
        getManager: () => ({
          listSessionsByWorkspaceId: () => [],
          reconnectSession: () => {
            calls.push('reconnect');
            return 'connected' as const;
          },
          getSession: () => session,
          createSession: () => '',
          replaySession: () => {
            calls.push('replay');
          },
          removeClient: () => {},
          handleInput: () => {},
          handleResize: () => {},
          destroySession: () => {},
        }) as never,
        getEventManager: () => ({
          subscribe: () => ({ type: 'snapshot' as const, sessions: [] }),
          unsubscribe: () => {},
        }) as never,
      },
      resolveAskTargets: () => [],
    });

    const { socket, sent } = makeTerminalSocket('/ws/terminal', { sessionId: 'sess-1', workspaceId: 'w1' });
    adapter.websocket.open!(socket);

    expect(calls).toEqual(['reconnect', 'replay']);
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(OPCODES.INIT_ACK);
  });

  test('terminal open with an unknown session sends an ERROR frame and closes', () => {
    const adapter = createBunWebSocketAdapter({
      auth: { isAuthEnabled: () => false, validateToken: () => true },
      terminal: {
        getManager: () => ({
          listSessionsByWorkspaceId: () => [],
          reconnectSession: () => 'not_found' as const,
          getSession: () => null,
          createSession: () => '',
          replaySession: () => {},
          removeClient: () => {},
          handleInput: () => {},
          handleResize: () => {},
          destroySession: () => {},
        }) as never,
        getEventManager: () => ({
          subscribe: () => ({ type: 'snapshot' as const, sessions: [] }),
          unsubscribe: () => {},
        }) as never,
      },
      resolveAskTargets: () => [],
    });

    const { socket, sent, closed } = makeTerminalSocket('/ws/terminal', { sessionId: 'missing', workspaceId: 'w1' });
    adapter.websocket.open!(socket);

    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(OPCODES.ERROR);
    expect(new TextDecoder().decode(sent[0].slice(1))).toBe('{"message":"Session not found"}');
    expect(closed).toEqual([true]);
  });

  test('terminal message input frames reach handleInput and resize frames reach handleResize', async () => {
    const calls: string[] = [];
    const adapter = createBunWebSocketAdapter({
      auth: { isAuthEnabled: () => false, validateToken: () => true },
      terminal: {
        getManager: () => ({
          listSessionsByWorkspaceId: () => [],
          reconnectSession: () => 'not_found' as const,
          getSession: () => null,
          createSession: () => '',
          replaySession: () => {},
          removeClient: () => {},
          handleInput: (_ws: unknown, data: string) => {
            calls.push(`input:${data}`);
          },
          handleResize: (_ws: unknown, cols: number, rows: number) => {
            calls.push(`resize:${cols}x${rows}`);
          },
          destroySession: () => {},
        }) as never,
        getEventManager: () => ({
          subscribe: () => ({ type: 'snapshot' as const, sessions: [] }),
          unsubscribe: () => {},
        }) as never,
      },
      resolveAskTargets: () => [],
    });

    const { socket } = makeTerminalSocket('/ws/terminal', {});
    const inputFrame = encodeFrame(0x01, new TextEncoder().encode('ls -la'));
    await adapter.websocket.message!(socket, Buffer.from(inputFrame) as unknown as string);

    const resizeFrame = encodeFrame(0x02, new TextEncoder().encode(JSON.stringify({ cols: 120, rows: 40 })));
    await adapter.websocket.message!(socket, Buffer.from(resizeFrame) as unknown as string);

    expect(calls).toEqual(['input:ls -la', 'resize:120x40']);
  });

  test('terminal events open subscribes and sends the snapshot', () => {
    const subscribeCalls: Array<{ workspaceId: string }> = [];
    const adapter = createBunWebSocketAdapter({
      auth: { isAuthEnabled: () => false, validateToken: () => true },
      terminal: {
        getManager: () => ({
          listSessionsByWorkspaceId: () => [{ id: 'sess-1' }] as unknown as TerminalSessionInfo[],
          reconnectSession: () => 'not_found' as const,
          getSession: () => null,
          createSession: () => '',
          replaySession: () => {},
          removeClient: () => {},
          handleInput: () => {},
          handleResize: () => {},
          destroySession: () => {},
        }) as never,
        getEventManager: () => ({
          subscribe: (workspaceId: string) => {
            subscribeCalls.push({ workspaceId });
            return { type: 'snapshot' as const, sessions: [] };
          },
          unsubscribe: () => {},
        }) as never,
      },
      resolveAskTargets: () => [],
    });

    const { socket, sent } = makeTerminalSocket('/ws/terminal/events', { workspaceId: 'w1' });
    adapter.websocket.open!(socket);

    expect(subscribeCalls).toEqual([{ workspaceId: 'w1' }]);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(new TextDecoder().decode(sent[0]))).toEqual({
      type: 'snapshot',
      sessions: [{ id: 'sess-1' }],
    });

    adapter.websocket.close!(socket, 0, '');
  });

  test('terminal close unsubscribes events and removes the terminal client', () => {
    const calls: string[] = [];
    const adapter = createBunWebSocketAdapter({
      auth: { isAuthEnabled: () => false, validateToken: () => true },
      terminal: {
        getManager: () => ({
          listSessionsByWorkspaceId: () => [],
          reconnectSession: () => 'not_found' as const,
          getSession: () => null,
          createSession: () => '',
          replaySession: () => {},
          removeClient: () => {
            calls.push('removeClient');
          },
          handleInput: () => {},
          handleResize: () => {},
          destroySession: () => {},
        }) as never,
        getEventManager: () => ({
          subscribe: () => ({ type: 'snapshot' as const, sessions: [] }),
          unsubscribe: (workspaceId: string) => {
            calls.push(`unsubscribe:${workspaceId}`);
          },
        }) as never,
      },
      resolveAskTargets: () => [],
    });

    const { socket } = makeTerminalSocket('/ws/terminal/events', { workspaceId: 'w1' });
    adapter.websocket.open!(socket);
    adapter.websocket.close!(socket, 0, '');
    expect(calls).toEqual(['unsubscribe:w1']);

    const terminal = makeTerminalSocket('/ws/terminal', {});
    adapter.websocket.close!(terminal.socket, 0, '');
    expect(calls).toEqual(['unsubscribe:w1', 'removeClient']);
  });
});
