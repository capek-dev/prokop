import type { ServerWebSocket, WebSocketHandler } from 'bun';
import type { AskAuthority, ClientMessage, ServerMessage, SessionControlUpdateReason } from '@jean2/sdk';
import type { ConnectionId } from './connection-id';
import { registerConnection, unregisterConnection, touchConnection, getConnectionBySocket } from './connection-registry';
import {
  handleConnectionDisconnect,
  sweepExpiredGrace,
  clearStaleTakeoverRequests,
  buildControlUpdatedMessage,
  type StaleTakeoverResult,
} from './control-registry';
import { createDeliveryPort, participantConnectionIdsFor, controllerConnectionIdsFor, type DeliveryPort } from './delivery';
import type { ClientEntry, RouterContext } from './router-context';
import { handleClientMessage } from './message-router';
import type { TerminalManager } from '../terminal/manager';
import type { TerminalEventManager } from '../terminal/event-manager';
import { encodeFrame, OPCODES } from '../terminal/frames';

export interface WsData {
  path: string;
  params?: Record<string, string>;
}

export type BunWebSocketConfig = WebSocketHandler<WsData>;

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const MAX_MISSED_PINGS = 3;
export const GRACE_SWEEP_INTERVAL_MS = 5_000;

export interface BunWebSocketAdapterDeps {
  auth: {
    isAuthEnabled(): boolean;
    validateToken(token: string): boolean;
  };
  terminal: {
    getManager(): TerminalManager;
    getEventManager(): TerminalEventManager;
  };
  /** Ask-target resolution injected from bootstrap; authority policy stays outside transport. */
  resolveAskTargets(sessionId: string, authority: AskAuthority): ConnectionId[];
}

export interface BunWebSocketAdapter {
  websocket: BunWebSocketConfig;
  delivery: DeliveryPort;
  handleUpgrade(
    req: Request,
    upgrade: (data: WsData) => boolean,
  ): { handled: true; response: Response | undefined } | { handled: false };
  startTimers(): void;
  stopTimers(): void;
  heartbeatTick(): void;
  graceSweepTick(): void;
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

export interface GraceSweepTickDeps {
  sweepExpiredGrace(): string[];
  clearStaleTakeoverRequests(): StaleTakeoverResult[];
  broadcastToSession(sessionId: string, message: ServerMessage): void;
  buildControlUpdatedMessage(sessionId: string, reason: SessionControlUpdateReason): ServerMessage;
}

export function runGraceSweepTick(deps: GraceSweepTickDeps): void {
  const expiredSessionIds = deps.sweepExpiredGrace();
  for (const sessionId of expiredSessionIds) {
    deps.broadcastToSession(sessionId, deps.buildControlUpdatedMessage(sessionId, 'grace_expired'));
  }

  const staleTakeoverResults = deps.clearStaleTakeoverRequests();
  for (const { sessionId, reason } of staleTakeoverResults) {
    deps.broadcastToSession(sessionId, deps.buildControlUpdatedMessage(sessionId, reason));
  }
}

// Adapter

export function createBunWebSocketAdapter(deps: BunWebSocketAdapterDeps): BunWebSocketAdapter {
  const sockets = new Map<ConnectionId, ServerWebSocket<WsData>>();
  const clients = new Map<ConnectionId, ClientEntry>();

  function sendToConnection(connectionId: ConnectionId, message: ServerMessage): void {
    const socket = sockets.get(connectionId);
    if (!socket) return;
    socket.send(JSON.stringify(message));
  }

  function sendToOpenConnection(connectionId: ConnectionId, message: ServerMessage): void {
    const socket = sockets.get(connectionId);
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
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
  ): { handled: true; response: Response | undefined } | { handled: false } {
    const url = new URL(req.url);

    if (url.pathname === '/ws/terminal/events') {
      if (deps.auth.isAuthEnabled()) {
        const token = url.searchParams.get('token');
        if (!token || !deps.auth.validateToken(token)) {
          return {
            handled: true,
            response: new Response(
              JSON.stringify({ error: 'Unauthorized', message: 'Invalid or missing API token' }),
              { status: 401, headers: { 'Content-Type': 'application/json' } }
            ),
          };
        }
      }

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

      const upgraded = upgrade({ path: '/ws/terminal/events', params: { workspaceId } });
      if (!upgraded) {
        return { handled: true, response: new Response('WebSocket upgrade failed', { status: 400 }) };
      }
      return { handled: true, response: undefined };
    }

    if (url.pathname === '/ws/terminal') {
      if (deps.auth.isAuthEnabled()) {
        const token = url.searchParams.get('token');
        if (!token || !deps.auth.validateToken(token)) {
          return {
            handled: true,
            response: new Response(
              JSON.stringify({
                error: 'Unauthorized',
                message: 'Invalid or missing API token for terminal connection',
              }),
              {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
              }
            ),
          };
        }
      }

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
      const upgraded = upgrade({ path: '/ws/terminal', params });
      if (!upgraded) {
        return { handled: true, response: new Response('WebSocket upgrade failed', { status: 400 }) };
      }
      return { handled: true, response: undefined };
    }

    if (url.pathname === '/ws') {
      if (deps.auth.isAuthEnabled()) {
        const token = url.searchParams.get('token');

        if (!token || !deps.auth.validateToken(token)) {
          return {
            handled: true,
            response: new Response(
              JSON.stringify({
                error: 'Unauthorized',
                message: 'Invalid or missing API token for WebSocket connection'
              }),
              {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
              }
            ),
          };
        }
      }

      const upgraded = upgrade({ path: '/ws' });
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
    idleTimeout: parseInt(process.env.JEAN2_WS_IDLE_TIMEOUT || '255', 10),

    open(ws) {
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
      const disconnectTransitions = handleConnectionDisconnect(conn.connectionId);
      for (const { sessionId, reason } of disconnectTransitions) {
        delivery.broadcastToSession(sessionId, buildControlUpdatedMessage(sessionId, reason));
      }
      unregisterConnection(ws);
    },

    async message(ws, message) {
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
        await handleClientMessage(routerContext, conn.connectionId, msg);
      } catch (err) {
        console.error('WebSocket message error:', err);
        ws.send(JSON.stringify({ type: 'error', code: 'parse_error', message: String(err) }));
      }
    },
  };

  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  let sweepInterval: ReturnType<typeof setInterval> | undefined;

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

  const graceSweepTick = () => {
    runGraceSweepTick({
      sweepExpiredGrace,
      clearStaleTakeoverRequests,
      broadcastToSession: delivery.broadcastToSession,
      buildControlUpdatedMessage,
    });
  };

  return {
    websocket,
    delivery,
    handleUpgrade,
    startTimers() {
      if (!heartbeatInterval) {
        heartbeatInterval = setInterval(heartbeatTick, HEARTBEAT_INTERVAL_MS);
      }
      if (!sweepInterval) {
        sweepInterval = setInterval(graceSweepTick, GRACE_SWEEP_INTERVAL_MS);
      }
    },
    stopTimers() {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = undefined;
      }
      if (sweepInterval) {
        clearInterval(sweepInterval);
        sweepInterval = undefined;
      }
    },
    heartbeatTick,
    graceSweepTick,
  };
}
