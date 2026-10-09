import type { ServerWebSocket, WebSocketHandler } from 'bun';
import type { AskAuthority, ClientMessage, ServerMessage } from '@prokopai/sdk';
import type { ConnectionId } from './connection-id';
import type { AccessPrincipal } from '@/application/device-access/service';
import { registerConnection, unregisterConnection, touchConnection, getConnectionBySocket } from './connection-registry';
import { handleConnectionDisconnect } from './control-registry';
import { createDeliveryPort, participantConnectionIdsFor, controllerConnectionIdsFor, type DeliveryPort } from './delivery';
import type { ClientEntry, RouterContext } from './router-context';
import { handleClientMessage } from './message-router';
import type { TerminalManager } from '@/transport/terminal/manager';
import { readEnvInt } from '@/infrastructure/runtime/env-compat';
import type { TerminalEventManager } from '@/transport/terminal/event-manager';
import { encodeFrame, OPCODES } from '@/transport/terminal/frames';
import { stallMonitor } from '@/utils/stall-monitor';

export interface WsData {
  path: string;
  params?: Record<string, string>;
  /** Paired device that opened this socket; absent for same-machine and shared-token callers. */
  deviceId?: string;
  /** Arrived from another machine directly (not through a same-machine proxy). */
  viaNetwork?: boolean;
}

export type BunWebSocketConfig = WebSocketHandler<WsData>;

export const HEARTBEAT_INTERVAL_MS = 30_000;
/** Close code for sockets whose device was revoked; clients must pair again instead of reconnecting. */
export const ACCESS_REVOKED_CLOSE_CODE = 4401;
export const MAX_MISSED_PINGS = 3;

export interface BunWebSocketAdapterDeps {
  terminal: {
    getManager(): TerminalManager;
    getEventManager(): TerminalEventManager;
  };
  /** Ask-target resolution injected from bootstrap; authority policy stays outside transport. */
  resolveAskTargets(sessionId: string, authority: AskAuthority): ConnectionId[];
  /** Releases per-connection application state (Git status subscriptions). */
  onConnectionClosed?(connectionId: ConnectionId): void;
}

export interface BunWebSocketAdapter {
  websocket: BunWebSocketConfig;
  delivery: DeliveryPort;
  /** `principal` is resolved by the listener; null means the caller is not authorized. */
  handleUpgrade(
    req: Request,
    upgrade: (data: WsData) => boolean,
    principal: AccessPrincipal | null,
    connection?: { viaNetwork: boolean },
  ): { handled: true; response: Response | undefined } | { handled: false };
  /** Closes every socket opened by a revoked device. */
  closeDeviceSockets(deviceId: string): void;
  /** Closes sockets that arrived over the network, after network listening is turned off. */
  closeNetworkSockets(): void;
  startTimers(): void;
  stopTimers(): void;
  shutdown(): void;
  heartbeatTick(): void;
}

// Lifecycle ticks (exported separately so tests can drive them deterministically)

export interface HeartbeatTickDeps {
  clients: Map<ConnectionId, ClientEntry>;
  getSocket(connectionId: ConnectionId): ServerWebSocket<WsData> | undefined;
  touchConnection(socket: ServerWebSocket<WsData>): void;
  onTimedOut(connectionId: ConnectionId): void;
}

export function runHeartbeatTick(deps: HeartbeatTickDeps): void {
  for (const [connectionId, data] of deps.clients.entries()) {
    const socket = deps.getSocket(connectionId);
    if (socket && socket.readyState === WebSocket.OPEN) {
      data.missedPings++;
      if (data.missedPings > MAX_MISSED_PINGS) {
        socket.close(1000, 'Heartbeat timeout');
        deps.onTimedOut(connectionId);
      } else {
        socket.send(JSON.stringify({ type: 'ping' }));
        deps.touchConnection(socket);
      }
    }
  }
}

// Adapter

export function createBunWebSocketAdapter(deps: BunWebSocketAdapterDeps): BunWebSocketAdapter {
  let shuttingDown = false;
  const allSockets = new Set<ServerWebSocket<WsData>>();
  const sockets = new Map<ConnectionId, ServerWebSocket<WsData>>();
  const clients = new Map<ConnectionId, ClientEntry>();

  function sendToConnection(connectionId: ConnectionId, message: ServerMessage): void {
    const socket = sockets.get(connectionId);
    if (!socket) return;
    stallMonitor.sync(`out ${message.type}`, () => socket.send(JSON.stringify(message)));
  }

  function sendToOpenConnection(connectionId: ConnectionId, message: ServerMessage): void {
    const socket = sockets.get(connectionId);
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    stallMonitor.sync(`out ${message.type}`, () => socket.send(JSON.stringify(message)));
  }

  const delivery = createDeliveryPort({
    sendToConnection,
    sendToOpenConnection,
    connectionIds: () => Array.from(clients.keys()),
    participantConnectionIds: participantConnectionIdsFor,
    controllerConnectionIds: controllerConnectionIdsFor,
    askTargetConnectionIds: deps.resolveAskTargets,
  });

  const routerContext: RouterContext<ConnectionId> = {
    send: delivery.sendToConnection,
    broadcast: delivery.broadcast,
    broadcastToSession: delivery.broadcastToSession,
    sendToController: delivery.sendToController,
    sendToAskTargets: delivery.sendToAskTargets,
    clients,
  };

  function handleUpgrade(
    req: Request,
    upgrade: (data: WsData) => boolean,
    principal: AccessPrincipal | null,
    connection?: { viaNetwork: boolean },
  ): { handled: true; response: Response | undefined } | { handled: false } {
    const url = new URL(req.url);
    if (!['/ws', '/ws/terminal', '/ws/terminal/events'].includes(url.pathname)) {
      return { handled: false };
    }
    if (shuttingDown) {
      return { handled: true, response: new Response('Server shutting down', { status: 503 }) };
    }
    if (principal === null) {
      return {
        handled: true,
        response: new Response(
          JSON.stringify({
            error: 'Unauthorized',
            reason: 'pairing-required',
            message: 'This device is not paired with this server.',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      };
    }
    const identity = {
      ...(principal.kind === 'device' ? { deviceId: principal.deviceId } : {}),
      ...(connection?.viaNetwork ? { viaNetwork: true } : {}),
    };

    if (url.pathname === '/ws/terminal/events') {

      const workspaceId = url.searchParams.get('workspaceId') || '';
      if (!workspaceId) {
        return {
          handled: true,
          response: new Response(
            JSON.stringify({ error: 'bad_request', message: 'Missing required parameter: workspaceId' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          ),
        };
      }

      const upgraded = upgrade({ path: '/ws/terminal/events', params: { workspaceId }, ...identity });
      if (!upgraded) {
        return { handled: true, response: new Response('WebSocket upgrade failed', { status: 400 }) };
      }
      return { handled: true, response: undefined };
    }

    if (url.pathname === '/ws/terminal') {

      const cwd = url.searchParams.get('cwd');
      const workspaceId = url.searchParams.get('workspaceId') || 'default';
      const shell = url.searchParams.get('shell') || undefined;
      const sessionId = url.searchParams.get('sessionId') || undefined;

      if (!cwd || !workspaceId) {
        return {
          handled: true,
          response: new Response(
            JSON.stringify({ error: 'bad_request', message: 'Missing required parameter: cwd' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          ),
        };
      }

      const params: Record<string, string> = { cwd, workspaceId };
      if (shell) params.shell = shell;
      if (sessionId) params.sessionId = sessionId;
      const upgraded = upgrade({ path: '/ws/terminal', params, ...identity });
      if (!upgraded) {
        return { handled: true, response: new Response('WebSocket upgrade failed', { status: 400 }) };
      }
      return { handled: true, response: undefined };
    }

    if (url.pathname === '/ws') {

      const upgraded = upgrade({ path: '/ws', ...identity });
      if (!upgraded) {
        return { handled: true, response: new Response('WebSocket upgrade failed', { status: 400 }) };
      }
      return { handled: true, response: undefined };
    }

    return { handled: false };
  }

  function handleTerminalMessage(ws: ServerWebSocket<WsData>, message: string | Buffer | undefined): void {
    try {
      if (!message) return;
      const data = message instanceof Buffer
        ? new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
        : new TextEncoder().encode(message as string);
      if (data.length < 1) return;

      const opcode = data[0];
      const payload = data.slice(1);

      switch (opcode) {
        case 0x01: {
          const input = new TextDecoder().decode(payload);
          deps.terminal.getManager().handleInput(ws, input);
          break;
        }
        case 0x02: {
          const { cols, rows } = JSON.parse(new TextDecoder().decode(payload)) as { cols: number; rows: number };
          deps.terminal.getManager().handleResize(ws, cols, rows);
          break;
        }
        case 0x03: {
          deps.terminal.getManager().destroySession(ws);
          ws.close();
          break;
        }
      }
    } catch (err) {
      console.error('Terminal message error:', err);
    }
  }

  const websocket: BunWebSocketConfig = {
    idleTimeout: readEnvInt('WS_IDLE_TIMEOUT', 255),

    open(ws) {
      if (shuttingDown) {
        ws.close(1001, 'Server shutting down');
        return;
      }
      allSockets.add(ws);
      const wsData = ws.data;
      if (wsData?.path === '/ws/terminal/events') {
        const workspaceId = wsData.params?.workspaceId || '';
        const sessions = deps.terminal.getManager().listSessionsByWorkspaceId(workspaceId);
        deps.terminal.getEventManager().subscribe(workspaceId, ws);
        ws.send(JSON.stringify({ type: 'snapshot', sessions }));
        return;
      }
      if (wsData?.path === '/ws/terminal') {
        const sessionId = wsData.params?.sessionId;
        if (sessionId) {
          const workspaceId = wsData.params?.workspaceId || '';
          const reconnectResult = deps.terminal.getManager().reconnectSession(
            ws,
            sessionId,
            workspaceId
          );
          if (reconnectResult !== 'connected') {
            const message = reconnectResult === 'workspace_mismatch'
              ? 'Terminal session does not belong to this workspace'
              : 'Session not found';
            const errorPayload = new TextEncoder().encode(JSON.stringify({ message }));
            ws.send(encodeFrame(OPCODES.ERROR, errorPayload));
            ws.close();
            return;
          }
          const session = deps.terminal.getManager().getSession(sessionId);
          if (session) {
            const initPayload = new TextEncoder().encode(JSON.stringify({
              sessionId: session.id,
              pid: session.pid,
              shell: session.shell,
              cwd: session.cwd,
              cols: session.cols,
              rows: session.rows,
              createdAt: session.createdAt,
              status: session.status,
              exitCode: session.exitCode,
              isReconnect: true,
              title: session.title,
              inAlternateScreen: session.inAlternateScreen,
            }));
            ws.send(encodeFrame(OPCODES.INIT_ACK, initPayload));
            deps.terminal.getManager().replaySession(ws);
          }
        } else {
          const createdId = deps.terminal.getManager().createSession(ws, {
            shell: wsData.params?.shell,
            cwd: wsData.params?.cwd || '',
            workspaceId: wsData.params?.workspaceId || '',
            cols: 80,
            rows: 24,
          });
          if (createdId) {
            const session = deps.terminal.getManager().getSession(createdId);
            if (session) {
              const initPayload = new TextEncoder().encode(JSON.stringify({
                sessionId: session.id,
                pid: session.pid,
                shell: session.shell,
                cwd: session.cwd,
                cols: session.cols,
                rows: session.rows,
                createdAt: session.createdAt,
                status: session.status,
                exitCode: session.exitCode,
                isReconnect: false,
                title: session.title,
                inAlternateScreen: session.inAlternateScreen,
              }));
              ws.send(encodeFrame(OPCODES.INIT_ACK, initPayload));
            }
          }
        }
        return;
      }
      const connectionId = registerConnection(ws);
      sockets.set(connectionId, ws);
      clients.set(connectionId, { sessionIds: new Set(), missedPings: 0 });
    },

    close(ws) {
      allSockets.delete(ws);
      const wsData = ws.data;
      if (wsData?.path === '/ws/terminal/events') {
        const workspaceId = wsData.params?.workspaceId || '';
        deps.terminal.getEventManager().unsubscribe(workspaceId, ws);
        return;
      }
      if (wsData?.path === '/ws/terminal') {
        deps.terminal.getManager().removeClient(ws);
        return;
      }
      const conn = getConnectionBySocket(ws);
      if (!conn) return;
      clients.delete(conn.connectionId);
      sockets.delete(conn.connectionId);
      handleConnectionDisconnect(conn.connectionId);
      try {
        deps.onConnectionClosed?.(conn.connectionId);
      } catch (error: unknown) {
        console.error('WebSocket close cleanup failed:', error);
      }
      unregisterConnection(ws);
    },

    async message(ws, message) {
      if (shuttingDown) return;
      const wsData = ws.data;
      if (wsData?.path === '/ws/terminal') {
        if (message !== undefined) {
          handleTerminalMessage(ws, message);
        }
        return;
      }
      const conn = getConnectionBySocket(ws);
      if (!conn) return;
      try {
        const msg: ClientMessage = JSON.parse((message ?? '').toString());
        await stallMonitor.sync(`ws ${msg.type}`, () => handleClientMessage(routerContext, conn.connectionId, msg));
      } catch (err) {
        console.error('WebSocket message error:', err);
        ws.send(JSON.stringify({ type: 'error', code: 'parse_error', message: String(err) }));
      }
    },
  };

  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  const heartbeatTick = () => {
    runHeartbeatTick({
      clients,
      getSocket: (connectionId) => sockets.get(connectionId),
      touchConnection,
      onTimedOut: (connectionId) => {
        clients.delete(connectionId);
        sockets.delete(connectionId);
      },
    });
  };

  return {
    websocket,
    delivery,
    handleUpgrade,
    closeDeviceSockets(deviceId) {
      for (const socket of allSockets) {
        if (socket.data.deviceId === deviceId) socket.close(ACCESS_REVOKED_CLOSE_CODE, 'Access revoked');
      }
    },
    closeNetworkSockets() {
      for (const socket of allSockets) {
        if (socket.data.viaNetwork) socket.close(1001, 'Network access turned off');
      }
    },
    startTimers() {
      if (!shuttingDown && !heartbeatInterval) {
        heartbeatInterval = setInterval(heartbeatTick, HEARTBEAT_INTERVAL_MS);
      }
    },
    stopTimers() {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = undefined;
      }
    },
    shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = undefined;
      }
      const failures: unknown[] = [];
      for (const socket of allSockets) {
        try {
          socket.close(1001, 'Server shutting down');
        } catch (error: unknown) {
          failures.push(error);
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, 'Failed to close server sockets');
    },
    heartbeatTick,
  };
}
