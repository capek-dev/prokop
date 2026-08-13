globalThis.AI_SDK_LOG_WARNINGS = false;

import { readFileSync } from 'fs';

import { createApp } from '@/app';
import { configureCapekJean2Compatibility } from '@/capek-adapter';
import { registerBroadcastCallback, registerSendToControllerCallback, registerBroadcastToSessionCallback, registerSendToAskTargetsCallback, sendToAskTargetsEvent } from '@/core/broadcast';
import { handleClientMessage, type RouterContext, type ClientEntry } from '@/core/message-router';
import {
  registerConnection as registryRegisterConnection,
  unregisterConnection as registryUnregisterConnection,
  touchConnection,
} from '@/core/client-registry';
import { handleConnectionDisconnect as handleControlDisconnect, sweepExpiredGrace, clearStaleTakeoverRequests, buildControlUpdatedMessage, getParticipantConnections, getControllerConnections } from '@/core/session-control-registry';
import { scanTools } from '@/tools';
import { closeDatabase } from '@/store';
import { backfillFts } from '@/session-search/fts';
import type { ServerMessage, ClientMessage, AskAuthority } from '@jean2/sdk';
import { getTerminalManager, getTerminalEventManager, encodeFrame, OPCODES } from '@/services/terminal';
import { cleanupRunningSessionsOnStartup } from '@/store/terminal-sessions';
import {
  reconcileAllSessionsCompaction,
  reconcileAllOrphanedToolCalls,
  cleanupAllPendingAsks,
  cleanupOrphanedData,
} from '@/store';
import { getPort, getHost } from '@/config';
import type { ServerWebSocket } from 'bun';
import { validateToken, isAuthEnabled } from '@/auth/token';
import {
  getLLMOpenAIApiKey,
  getLLMOpenRouterApiKey,
  getLLMMinimaxApiKey,
  getLLMZhipuApiKey,
  getLLMZhipuCodingApiKey,
  getTlsEnabled,
  getTlsCertFile,
  getTlsKeyFile,
  getClientEnabled,
  getClientPort,
  getLLMDeepseekApiKey,
} from '@/env';
import { activateSandbox } from '@/sandbox';
import {
  createClientLauncher,
  prepareAndLaunchClient,
  type ClientLauncher,
} from '@/services/client-launcher';
import { startScheduler, stopScheduler } from '@/scheduler';
import { startPushRetryScheduler, stopPushRetryScheduler, cleanupPushData } from '@/services/web-push/retry-scheduler';

interface WsData {
  path: string;
  params?: Record<string, string>;
}

export interface ServerOptions {
  port?: number;
  host?: string;
}

export interface ServerInstance {
  server: ReturnType<typeof Bun.serve>;
  cleanup: () => void;
}

const clients = new Map<ServerWebSocket, ClientEntry>();

function broadcast(message: ServerMessage, excludeWs?: ServerWebSocket) {
  const messageStr = JSON.stringify(message);
  for (const [ws] of clients.entries()) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(messageStr);
    }
  }
}

function send(ws: ServerWebSocket, msg: ServerMessage) {
  ws.send(JSON.stringify(msg));
}

function broadcastToSession(sessionId: string, message: ServerMessage, excludeWs?: ServerWebSocket) {
  const messageStr = JSON.stringify(message);
  const connections = getParticipantConnections(sessionId);
  for (const conn of connections) {
    if (conn.ws !== excludeWs && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(messageStr);
    }
  }
}

function sendToController(sessionId: string, message: ServerMessage) {
  const messageStr = JSON.stringify(message);
  const connections = getControllerConnections(sessionId);
  for (const conn of connections) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(messageStr);
    }
  }
}

function sendToAskTargets(sessionId: string, authority: AskAuthority, message: ServerMessage) {
  sendToAskTargetsEvent(sessionId, authority, message);
}

const routerContext: RouterContext = { send, broadcast, broadcastToSession, sendToController, sendToAskTargets, clients };

async function startServer(options?: ServerOptions): Promise<ServerInstance> {
  configureCapekJean2Compatibility();
  cleanupRunningSessionsOnStartup();
  reconcileAllSessionsCompaction();
  reconcileAllOrphanedToolCalls();
  cleanupAllPendingAsks();

  const cleanupStats = cleanupOrphanedData();
  const totalOrphaned = Object.values(cleanupStats).reduce((sum, v) => sum + v, 0);
  if (totalOrphaned > 0) {
    console.log('[cleanup] Removed orphaned data:', cleanupStats);
  }

  backfillFts();
  cleanupPushData();

  const port = options?.port ?? getPort();
  const host = options?.host ?? getHost();

  console.log('Starting AI Agent Server...');

  registerBroadcastCallback(broadcast as (message: ServerMessage, excludeWs?: unknown) => void);
  registerSendToControllerCallback(sendToController);
  registerBroadcastToSessionCallback(broadcastToSession);
  registerSendToAskTargetsCallback(send as (ws: unknown, msg: ServerMessage) => void);

  const availableProviders: string[] = [];
  if (getLLMOpenAIApiKey()) availableProviders.push('openai');
  if (getLLMOpenRouterApiKey()) availableProviders.push('openrouter');
  if (getLLMMinimaxApiKey()) availableProviders.push('minimax');
  if (getLLMZhipuApiKey()) availableProviders.push('zhipu');
  if (getLLMZhipuCodingApiKey()) availableProviders.push('zhipu-coding');
  if (getLLMDeepseekApiKey()) availableProviders.push('deepseek');

  if (availableProviders.length > 0) {
    console.log(`Available providers: ${availableProviders.join(', ')}`);
  } else {
    console.warn('WARNING: No LLM API keys configured. Chat will not work.');
    console.warn('Set at least one of: JEAN2_LLM_OPENAI_API_KEY, JEAN2_LLM_OPENROUTER_API_KEY, JEAN2_LLM_MINIMAX_API_KEY, JEAN2_LLM_DEEPSEEK_API_KEY');
  }

  console.log('Scanning for tools...');
  const tools = await scanTools();
  console.log(`Found ${tools.length} tools: ${tools.map(t => t.definition.name).join(', ')}`);

  const app = createApp();

  if (process.env.JEAN2_SANDBOX === 'true') {
    activateSandbox((event) => {
      broadcast(event as unknown as ServerMessage);
    });
  }

  let tls: { cert: string; key: string } | undefined;
  if (getTlsEnabled()) {
    const certPath = getTlsCertFile();
    const keyPath = getTlsKeyFile();
    if (!certPath || !keyPath) {
      console.error('ERROR: JEAN2_TLS_ENABLED is set but JEAN2_TLS_CERT_FILE and/or JEAN2_TLS_KEY_FILE are not configured.');
      process.exit(1);
    }
    try {
      tls = { cert: readFileSync(certPath, 'utf-8'), key: readFileSync(keyPath, 'utf-8') };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`ERROR: Failed to read TLS certificate/key files: ${message}`);
      process.exit(1);
    }
  }
  const protocol = tls ? 'https' : 'http';

  console.log(`Server starting on ${protocol}://${host}:${port}`);

  const server = Bun.serve({
    port,
    hostname: host,
    ...(tls && { tls }),

    async fetch(req: Request): Promise<Response | undefined> {
      const url = new URL(req.url);

      if (url.pathname === '/ws/terminal/events') {
        if (isAuthEnabled()) {
          const token = url.searchParams.get('token');
          if (!token || !validateToken(token)) {
            return new Response(
              JSON.stringify({ error: 'Unauthorized', message: 'Invalid or missing API token' }),
              { status: 401, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }

        const workspaceId = url.searchParams.get('workspaceId') || '';
        if (!workspaceId) {
          return new Response(
            JSON.stringify({ error: 'bad_request', message: 'Missing required parameter: workspaceId' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const upgraded = server.upgrade(req, {
          data: { path: '/ws/terminal/events', params: { workspaceId } } as unknown as undefined,
        });
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 400 });
        }
        return undefined;
      }

      if (url.pathname === '/ws/terminal') {
        if (isAuthEnabled()) {
          const token = url.searchParams.get('token');
          if (!token || !validateToken(token)) {
            return new Response(
              JSON.stringify({
                error: 'Unauthorized',
                message: 'Invalid or missing API token for terminal connection',
              }),
              {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
              }
            );
          }
        }

        const cwd = url.searchParams.get('cwd');
        const workspaceId = url.searchParams.get('workspaceId') || 'default';
        const shell = url.searchParams.get('shell') || undefined;
        const sessionId = url.searchParams.get('sessionId') || undefined;

        if (!cwd || !workspaceId) {
          return new Response(
            JSON.stringify({ error: 'bad_request', message: 'Missing required parameter: cwd' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const params: Record<string, string> = { cwd, workspaceId };
        if (shell) params.shell = shell;
        if (sessionId) params.sessionId = sessionId;
        const upgraded = server.upgrade(req, {
          data: { path: '/ws/terminal', params } as unknown as undefined,
        });
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 400 });
        }
        return undefined;
      }

      if (url.pathname === '/ws') {
        if (isAuthEnabled()) {
          const token = url.searchParams.get('token');

          if (!token || !validateToken(token)) {
            return new Response(
              JSON.stringify({
                error: 'Unauthorized',
                message: 'Invalid or missing API token for WebSocket connection'
              }),
              {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
              }
            );
          }
        }

        const upgraded = server.upgrade(req, {
          data: { path: '/ws' } as unknown as undefined,
        });
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 400 });
        }
        return undefined;
      }

      return app.fetch(req);
    },

    websocket: {
      idleTimeout: parseInt(process.env.JEAN2_WS_IDLE_TIMEOUT || '255', 10),
      open(ws) {
        const wsData = ws.data as WsData | undefined;
        if (wsData?.path === '/ws/terminal/events') {
          const workspaceId = wsData.params?.workspaceId || '';
          const sessions = getTerminalManager().listSessionsByWorkspaceId(workspaceId);
          getTerminalEventManager().subscribe(workspaceId, ws as unknown as ServerWebSocket);
          ws.send(JSON.stringify({ type: 'snapshot', sessions }));
          return;
        }
        if (wsData?.path === '/ws/terminal') {
          const sessionId = wsData.params?.sessionId;
          if (sessionId) {
            const workspaceId = wsData.params?.workspaceId || '';
            const reconnectResult = getTerminalManager().reconnectSession(
              ws as unknown as ServerWebSocket,
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
            const session = getTerminalManager().getSession(sessionId);
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
              getTerminalManager().replaySession(ws as unknown as ServerWebSocket);
            }
          } else {
            const createdId = getTerminalManager().createSession(ws as unknown as ServerWebSocket, {
              shell: wsData.params?.shell,
              cwd: wsData.params?.cwd || '',
              workspaceId: wsData.params?.workspaceId || '',
              cols: 80,
              rows: 24,
            });
            if (createdId) {
              const session = getTerminalManager().getSession(createdId);
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
        clients.set(ws, { sessionIds: new Set(), missedPings: 0 });
        registryRegisterConnection(ws);
      },

      close(ws) {
        const wsData = ws.data as WsData | undefined;
        if (wsData?.path === '/ws/terminal/events') {
          const workspaceId = wsData.params?.workspaceId || '';
          getTerminalEventManager().unsubscribe(workspaceId, ws as unknown as ServerWebSocket);
          return;
        }
        if (wsData?.path === '/ws/terminal') {
          getTerminalManager().removeClient(ws as unknown as ServerWebSocket);
          return;
        }
        clients.delete(ws);
        const disconnectTransitions = handleControlDisconnect(ws);
        for (const { sessionId, reason } of disconnectTransitions) {
          broadcastToSession(sessionId, buildControlUpdatedMessage(sessionId, reason));
        }
        registryUnregisterConnection(ws);
      },

      async message(ws, message) {
        const wsData = ws.data as WsData | undefined;
        if (wsData?.path === '/ws/terminal') {
          if (message !== undefined) {
            handleTerminalMessage(ws as unknown as ServerWebSocket, message as string | Buffer | undefined);
          }
          return;
        }
        try {
          const msg: ClientMessage = JSON.parse((message ?? '').toString());
          await handleClientMessage(routerContext, ws, msg);
        } catch (err) {
          console.error('WebSocket message error:', err);
          ws.send(JSON.stringify({ type: 'error', code: 'parse_error', message: String(err) }));
        }
      },
    },
  });

  const HEARTBEAT_INTERVAL_MS = 30_000;
  const MAX_MISSED_PINGS = 3;
  const GRACE_SWEEP_INTERVAL_MS = 5_000;

  const heartbeatInterval = setInterval(() => {
    for (const [ws, data] of clients.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        data.missedPings++;
        if (data.missedPings > MAX_MISSED_PINGS) {
          ws.close(1000, 'Heartbeat timeout');
          clients.delete(ws);
        } else {
          ws.send(JSON.stringify({ type: 'ping' }));
          touchConnection(ws);
        }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  const graceSweepInterval = setInterval(() => {
    const expiredSessionIds = sweepExpiredGrace();
    for (const sessionId of expiredSessionIds) {
      broadcastToSession(sessionId, buildControlUpdatedMessage(sessionId, 'grace_expired'));
    }

    const staleTakeoverResults = clearStaleTakeoverRequests();
    for (const { sessionId, reason } of staleTakeoverResults) {
      broadcastToSession(sessionId, buildControlUpdatedMessage(sessionId, reason));
    }
  }, GRACE_SWEEP_INTERVAL_MS);

  // Start the scheduler tick loop (catches jobs that became due while offline)
  startScheduler();
  startPushRetryScheduler();

  let clientLauncher: ClientLauncher | undefined;

  if (getClientEnabled()) {
    clientLauncher = createClientLauncher();
    const { version, launchResult } = await prepareAndLaunchClient(
      clientLauncher,
      getClientPort(),
      port,
      host,
    );

    if (launchResult?.success) {
      console.log(`[client] @jean2/client@${version} running at ${launchResult.url}`);
    } else if (launchResult) {
      console.warn(`[client] Failed to launch: ${launchResult.error}`);
    }
  } else {
    console.log('[client] Built-in client disabled (JEAN2_CLIENT_ENABLED=false)');
  }

  console.log(`AI Agent Server running at ${protocol}://${host}:${port}`);

  const onShutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    clearInterval(heartbeatInterval);
    clearInterval(graceSweepInterval);
    cleanup();
    process.exit(0);
  };

  process.on('SIGTERM', () => onShutdown('SIGTERM'));
  process.on('SIGINT', () => onShutdown('SIGINT'));

  const cleanup = () => {
    clearInterval(heartbeatInterval);
    clearInterval(graceSweepInterval);
    stopScheduler();
    stopPushRetryScheduler();
    clientLauncher?.stop();
    server.stop();
    getTerminalManager().destroyAllSessions();
    closeDatabase();
    process.removeListener('SIGTERM', onShutdown);
    process.removeListener('SIGINT', onShutdown);
  };

  return { server, cleanup };
}

function handleTerminalMessage(ws: ServerWebSocket, message: string | Buffer | undefined): void {
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
        getTerminalManager().handleInput(ws, input);
        break;
      }
      case 0x02: {
        const { cols, rows } = JSON.parse(new TextDecoder().decode(payload)) as { cols: number; rows: number };
        getTerminalManager().handleResize(ws, cols, rows);
        break;
      }
      case 0x03: {
        getTerminalManager().destroySession(ws);
        ws.close();
        break;
      }
    }
  } catch (err) {
    console.error('Terminal message error:', err);
  }
}

if (import.meta.main) {
  startServer().catch((err: unknown) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

export { startServer };
