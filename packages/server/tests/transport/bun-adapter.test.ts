import { afterEach, describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import type { TerminalSessionInfo } from '@prokopai/sdk';
import {
  createBunWebSocketAdapter,
  MAX_MISSED_PINGS,
  runHeartbeatTick,
  type WsData,
} from '@/transport/websocket/bun-adapter';
import { getConnectionBySocket, unregisterConnection } from '@/transport/websocket/connection-registry';
import { removeSessionControl } from '@/transport/websocket/control-registry';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import type { ClientEntry } from '@/transport/websocket/router-context';

interface FakeSocket {
  data: WsData;
  readyState: number;
  sent: Array<string | Uint8Array>;
  closedWith?: { code: number; reason: string };
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

const fakeSockets: FakeSocket[] = [];

afterEach(() => {
  for (const socket of fakeSockets.splice(0)) {
    unregisterConnection(socket as unknown as ServerWebSocket);
  }
  removeSessionControl('session-1');
  removeSessionControl('session-close');
});

function makeSocket(path: string, params?: Record<string, string>): FakeSocket {
  const socket: FakeSocket = {
    data: { path, params },
    readyState: WebSocket.OPEN,
    sent: [],
    send(data: string) {
      this.sent.push(data);
    },
    close(code?: number, reason?: string) {
      this.closedWith = code === undefined ? undefined : { code, reason: reason ?? '' };
      this.readyState = WebSocket.CLOSED;
    },
  };
  fakeSockets.push(socket);
  return socket;
}

function makeAdapter(overrides: Partial<Parameters<typeof createBunWebSocketAdapter>[0]> = {}) {
  const manager = {
    listSessionsByWorkspaceId: () => [] as TerminalSessionInfo[],
    reconnectSession: () => 'not_found' as const,
    getSession: () => null as TerminalSessionInfo | null,
    createSession: () => '',
    replaySession: () => {},
    removeClient: () => {},
    handleInput: () => {},
    handleResize: () => {},
    destroySession: () => {},
  };
  const eventManager = {
    subscribe: () => ({ type: 'snapshot' as const, sessions: [] }),
    unsubscribe: () => {},
  };

  return createBunWebSocketAdapter({
    auth: {
      isAuthEnabled: () => false,
      validateToken: () => true,
    },
    terminal: {
      getManager: () => manager as never,
      getEventManager: () => eventManager as never,
    },
    resolveAskTargets: () => [],
    ...overrides,
  });
}

function parsed(socket: FakeSocket, index = socket.sent.length - 1): Record<string, unknown> {
  return JSON.parse(String(socket.sent[index]));
}

describe('bun websocket adapter', () => {
  test('open on /ws registers an opaque connection and creates the ping bookkeeping entry', () => {
    const adapter = makeAdapter();
    const socket = makeSocket('/ws');

    adapter.websocket.open!(socket as unknown as ServerWebSocket<WsData>);

    const conn = getConnectionBySocket(socket)!;
    expect(conn).toBeDefined();
    expect(typeof conn.connectionId).toBe('string');
  });

  test('heartbeat tick pings, counts missed pings, and closes after the threshold', () => {
    const adapter = makeAdapter();
    const socket = makeSocket('/ws');
    adapter.websocket.open!(socket as unknown as ServerWebSocket<WsData>);
    const clients = new Map<ConnectionId, ClientEntry>();
    clients.set(getConnectionBySocket(socket)!.connectionId, { sessionIds: new Set(), missedPings: 0 });
    const getSocket = (id: ConnectionId) => (getConnectionBySocket(socket)!.connectionId === id ? socket : undefined) as unknown as ServerWebSocket<WsData> | undefined;

    for (let tick = 1; tick <= MAX_MISSED_PINGS; tick++) {
      runHeartbeatTick({
        clients,
        getSocket,
        touchConnection: () => {},
        onTimedOut: () => {},
      });
      expect(parsed(socket, socket.sent.length - tick)).toEqual({ type: 'ping' });
      expect(clients.get(getConnectionBySocket(socket)!.connectionId)!.missedPings).toBe(tick);
    }
    expect(socket.closedWith).toBeUndefined();

    let timedOut: ConnectionId | null = null;
    runHeartbeatTick({
      clients,
      getSocket,
      touchConnection: () => {},
      onTimedOut: (id) => {
        timedOut = id;
      },
    });

    expect(socket.closedWith).toEqual({ code: 1000, reason: 'Heartbeat timeout' });
    expect(timedOut === getConnectionBySocket(socket)!.connectionId).toBe(true);
  });

  test('message dispatches through the router and reports unknown types and parse errors', async () => {
    const adapter = makeAdapter();
    const socket = makeSocket('/ws');
    adapter.websocket.open!(socket as unknown as ServerWebSocket<WsData>);

    await adapter.websocket.message!(socket as unknown as ServerWebSocket<WsData>, JSON.stringify({ type: 'nope' }));
    expect(parsed(socket)).toEqual({ type: 'error', code: 'unknown_message', message: 'Unknown message type' });

    await adapter.websocket.message!(socket as unknown as ServerWebSocket<WsData>, 'not json');
    expect(parsed(socket)).toEqual({ type: 'error', code: 'parse_error', message: expect.any(String) });
  });

  test('pong resets the missed ping count through the adapter router', async () => {
    const adapter = makeAdapter();
    const socket = makeSocket('/ws');
    adapter.websocket.open!(socket as unknown as ServerWebSocket<WsData>);

    adapter.heartbeatTick();
    await adapter.websocket.message!(socket as unknown as ServerWebSocket<WsData>, JSON.stringify({ type: 'pong' }));
    adapter.heartbeatTick();

    // Ping frames stop after the pong reset, so total sent is: 1 ping + 1 ping.
    const pings = socket.sent.filter((raw) => JSON.parse(String(raw)).type === 'ping');
    expect(pings).toHaveLength(2);
    expect(socket.closedWith).toBeUndefined();
  });

  test('client.register then session.control.claim routes through the transport registry', async () => {
    const adapter = makeAdapter();
    const socket = makeSocket('/ws');
    adapter.websocket.open!(socket as unknown as ServerWebSocket<WsData>);

    await adapter.websocket.message!(socket as unknown as ServerWebSocket<WsData>, JSON.stringify({
      type: 'client.register',
      client: {
        clientId: 'controller',
        clientType: 'web',
        displayName: 'Controller',
        interactionMode: 'human',
        capabilities: [],
      },
    }));
    expect(parsed(socket).type).toBe('client.registered');

    await adapter.websocket.message!(socket as unknown as ServerWebSocket<WsData>, JSON.stringify({
      type: 'session.control.claim',
      sessionId: 'session-1',
    }));

    expect(getConnectionBySocket(socket)?.clientId).toBe('controller');
  });

  test('close runs control disconnect cleanup and unregisters the connection', () => {
    const adapter = makeAdapter();
    const socket = makeSocket('/ws');
    adapter.websocket.open!(socket as unknown as ServerWebSocket<WsData>);

    const conn = getConnectionBySocket(socket)!;
    conn.clientId = null;
    conn.activeSessionIds.add('session-close');

    adapter.websocket.close!(socket as unknown as ServerWebSocket<WsData>, 0, '');

    expect(getConnectionBySocket(socket)).toBeUndefined();
  });

  test('handleUpgrade preserves auth, parameter, and upgrade behavior for each path', () => {
    const upgrades: WsData[] = [];
    const adapter = makeAdapter({
      auth: {
        isAuthEnabled: () => true,
        validateToken: (token) => token === 'good',
      },
    });

    const wsResult = adapter.handleUpgrade(
      new Request('http://localhost/ws?token=good'),
      (data) => {
        upgrades.push(data);
        return true;
      },
    );
    expect(wsResult.handled).toBe(true);
    expect(upgrades).toEqual([{ path: '/ws' }]);

    const unauthorized = adapter.handleUpgrade(
      new Request('http://localhost/ws?token=bad'),
      () => true,
    );
    expect(unauthorized.handled).toBe(true);
    if (unauthorized.handled) {
      expect(unauthorized.response?.status).toBe(401);
    }

    const terminalEvents = adapter.handleUpgrade(
      new Request('http://localhost/ws/terminal/events?token=good&workspaceId=w1'),
      (data) => {
        upgrades.push(data);
        return true;
      },
    );
    expect(terminalEvents.handled).toBe(true);
    expect(upgrades[1]).toEqual({ path: '/ws/terminal/events', params: { workspaceId: 'w1' } });

    const terminalMissingWorkspace = adapter.handleUpgrade(
      new Request('http://localhost/ws/terminal/events?token=good'),
      () => true,
    );
    expect(terminalMissingWorkspace.handled).toBe(true);
    if (terminalMissingWorkspace.handled) {
      expect(terminalMissingWorkspace.response?.status).toBe(400);
    }

    const terminal = adapter.handleUpgrade(
      new Request('http://localhost/ws/terminal?token=good&cwd=/tmp&workspaceId=w1&shell=/bin/zsh&sessionId=s1'),
      (data) => {
        upgrades.push(data);
        return true;
      },
    );
    expect(terminal.handled).toBe(true);
    expect(upgrades[2]).toEqual({
      path: '/ws/terminal',
      params: { cwd: '/tmp', workspaceId: 'w1', shell: '/bin/zsh', sessionId: 's1' },
    });

    const appRoute = adapter.handleUpgrade(new Request('http://localhost/api/sessions'), () => true);
    expect(appRoute.handled).toBe(false);
  });

  test('terminal open dispatches to the terminal manager and sends INIT_ACK on reconnect', () => {
    const session: TerminalSessionInfo = {
      id: 'sess-1',
      pid: 100,
      shell: '/bin/zsh',
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
    const adapter = makeAdapter({
      terminal: {
        getManager: () => ({
          listSessionsByWorkspaceId: () => [],
          reconnectSession: () => 'connected' as const,
          getSession: () => session,
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
    });

    const socket = makeSocket('/ws/terminal', { sessionId: 'sess-1', workspaceId: 'w1' });
    adapter.websocket.open!(socket as unknown as ServerWebSocket<WsData>);

    expect(socket.sent.length).toBe(1);
    const frame = socket.sent[0];
    expect(frame).toBeInstanceOf(Uint8Array);
    const bytes = frame as Uint8Array;
    expect(bytes[0]).toBe(0x07);
    const payload = JSON.parse(new TextDecoder().decode(bytes.slice(1))) as Record<string, unknown>;
    expect(payload.sessionId).toBe('sess-1');
    expect(payload.isReconnect).toBe(true);
  });

  test('delivery port installed from the adapter reaches connected sockets with exact JSON', () => {
    const adapter = makeAdapter();
    const socket = makeSocket('/ws');
    adapter.websocket.open!(socket as unknown as ServerWebSocket<WsData>);
    const message = { type: 'session.created' as const, session: { id: 'sess-1' } as never };

    adapter.delivery.broadcast(message);

    expect(socket.sent).toEqual([JSON.stringify(message)]);
  });

  test('broadcast skips closed sockets like the legacy audience delivery', () => {
    const adapter = makeAdapter();
    const socket = makeSocket('/ws');
    adapter.websocket.open!(socket as unknown as ServerWebSocket<WsData>);
    socket.readyState = WebSocket.CLOSED;

    adapter.delivery.broadcast({ type: 'session.created', session: { id: 'sess-1' } as never });

    expect(socket.sent).toEqual([]);
  });

  test('origin delivery does not check readyState, matching the legacy send', () => {
    const adapter = makeAdapter();
    const socket = makeSocket('/ws');
    adapter.websocket.open!(socket as unknown as ServerWebSocket<WsData>);
    const id = getConnectionBySocket(socket)!.connectionId;
    socket.readyState = WebSocket.CLOSED;

    adapter.delivery.sendToConnection(id, { type: 'error', code: 'x', message: 'y' });

    expect(socket.sent).toEqual([JSON.stringify({ type: 'error', code: 'x', message: 'y' })]);
  });
});
