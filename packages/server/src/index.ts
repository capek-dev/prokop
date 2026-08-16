globalThis.AI_SDK_LOG_WARNINGS = false;

import { readFileSync } from 'fs';

import { createApp } from '@/app';
import { configureCapekJean2Compatibility } from '@/capek-adapter';
import { createWiredApplication } from '@/bootstrap/application';
import { installDeliveryPort } from '@/core/broadcast';
import { installWireApplication } from '@/transport/websocket/application';
import { resolveAskDeliveryTargets } from '@/core/capability-router';
import { createBunWebSocketAdapter, type WsData } from '@/transport/websocket/bun-adapter';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { scanTools } from '@capekai/core/compat/jean2';
import { closeDatabase } from '@/store';
import { backfillFts } from '@/session-search/fts';
import type { ServerMessage, AskAuthority } from '@jean2/sdk';
import { getTerminalManager, getTerminalEventManager } from '@/services/terminal';
import { cleanupRunningSessionsOnStartup } from '@/store/terminal-sessions';
import {
  reconcileAllSessionsCompaction,
  reconcileAllOrphanedToolCalls,
  cleanupAllPendingAsks,
  cleanupOrphanedData,
} from '@/store';
import { getPort, getHost } from '@/config';
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

export interface ServerOptions {
  port?: number;
  host?: string;
}

export interface ServerInstance {
  server: ReturnType<typeof Bun.serve>;
  cleanup: () => void;
}

async function startServer(options?: ServerOptions): Promise<ServerInstance> {
  configureCapekJean2Compatibility();
  const application = createWiredApplication();
  installWireApplication({ session: application.session, control: application.control });
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

  const transport = createBunWebSocketAdapter({
    auth: { isAuthEnabled, validateToken },
    terminal: {
      getManager: () => getTerminalManager(),
      getEventManager: () => getTerminalEventManager(),
    },
    resolveAskTargets: (sessionId: string, authority: AskAuthority): ConnectionId[] =>
      resolveAskDeliveryTargets(sessionId, authority).connections.map((conn) => conn.connectionId),
  });
  installDeliveryPort(transport.delivery);

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

  const app = createApp(application);

  if (process.env.JEAN2_SANDBOX === 'true') {
    activateSandbox((event) => {
      transport.delivery.broadcast(event as unknown as ServerMessage);
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
      const upgrade = transport.handleUpgrade(req, (data: WsData) => server.upgrade(req, { data }));
      if (upgrade.handled) {
        return upgrade.response;
      }

      return app.fetch(req);
    },

    websocket: transport.websocket,
  });

  transport.startTimers();

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
    transport.stopTimers();
    cleanup();
    process.exit(0);
  };

  process.on('SIGTERM', () => onShutdown('SIGTERM'));
  process.on('SIGINT', () => onShutdown('SIGINT'));

  const cleanup = () => {
    transport.stopTimers();
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

if (import.meta.main) {
  startServer().catch((err: unknown) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

export { startServer };
