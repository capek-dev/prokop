globalThis.AI_SDK_LOG_WARNINGS = false;

import { readFileSync } from 'fs';

import { createApp } from '@/transport/http/app';
import { createRuntime } from '@/bootstrap/create-runtime';
import { createWiredApplication } from '@/bootstrap/application';
import { installDeliveryPort } from '@/transport/websocket/broadcast';
import { installWireApplication } from '@/transport/websocket/application';
import { resolveAskDeliveryTargets, type AskDeliveryInventories } from '@/domains/controllers';
import { createBunWebSocketAdapter, type WsData } from '@/transport/websocket/bun-adapter';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import {
  getAllClients,
  getClientByClientId,
  getConnectionsForClient,
  type RegisteredConnection,
} from '@/transport/websocket/connection-registry';
import {
  getControllerConnections,
  getParticipantClientIds,
  getParticipantConnections,
} from '@/transport/websocket/control-registry';
import { scanTools } from '@/adapters/capek/contracts';
import { closeDatabase, getDatabase } from '@/infrastructure/sqlite/database';
import { backfillFts } from '@/infrastructure/session-search/fts';
import type { ServerMessage, AskAuthority } from '@jean2/sdk';
import { getTerminalManager, getTerminalEventManager } from '@/transport/terminal';
import { cleanupRunningSessionsOnStartup } from '@/infrastructure/sqlite/terminal-session-store';
import { reconcileAllSessionsCompaction } from '@/adapters/capek/compaction-recovery';
import {
  disposeJean2ExecutionScope,
  initializeJean2ExecutionScope,
} from '@/adapters/capek/execution-scope';
import { reconcileAllOrphanedToolCalls } from '@/infrastructure/sqlite/message-store';
import { cleanupAllPendingAsks } from '@/infrastructure/sqlite/pending-asks';
import { cleanupOrphanedData } from '@/infrastructure/sqlite/cleanup';
import { getPort, getHost } from '@/config';
import { validateToken, isAuthEnabled } from '@/transport/http/middleware/token';
import { ensurePromptsDir } from '@/config/prompts-registry';
// Static side-effect: OAuth providers register with Capek at module load,
// before any provider lookup (P2 requirement).
import '@/infrastructure/providers';
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
} from '@/infrastructure/runtime/environment';
import { activateSandbox } from '@/infrastructure/sandbox';
import {
  createClientLauncher,
  prepareAndLaunchClient,
  type ClientLauncher,
} from '@/infrastructure/runtime/client-launcher';
import { startPushRetryScheduler, stopPushRetryScheduler, cleanupPushData } from '@/infrastructure/web-push/retry-scheduler';
import {
  startProviderAccountLifecycle,
  stopProviderAccountLifecycle,
} from '@/infrastructure/providers';

export interface ServerOptions {
  port?: number;
  host?: string;
}

export interface ServerInstance {
  server: ReturnType<typeof Bun.serve>;
  cleanup: () => Promise<void>;
}

function resolveAskTargetConnections(
  sessionId: string,
  authority: AskAuthority,
): RegisteredConnection[] {
  const inventories: AskDeliveryInventories<RegisteredConnection> = {
    authority,
    controllerConnections: getControllerConnections(sessionId),
    participantConnections: getParticipantConnections(sessionId),
    clientIdOf: (conn) => conn.clientId,
    identityOf: (conn) => conn.connectionId,
    capabilitiesOf: (clientId) => getClientByClientId(clientId),
    connectionsForClient: (clientId) => getConnectionsForClient(clientId),
    globalClientIds: () => Array.from(getAllClients().keys()),
    participantClientIds: () => getParticipantClientIds(sessionId),
  };

  return resolveAskDeliveryTargets(inventories).connections;
}

async function startServer(options?: ServerOptions): Promise<ServerInstance> {
  // Prompts directory is ensured before first registry scan. Provider
  // registration happens at module load via the static import above.
  ensurePromptsDir();

  const agents = createRuntime();
  const application = createWiredApplication(agents);
  installWireApplication({ session: application.session, control: application.control, providers: application.providers, notifications: application.notifications, permissions: application.permissions });
  cleanupRunningSessionsOnStartup();
  reconcileAllSessionsCompaction();
  reconcileAllOrphanedToolCalls();
  cleanupAllPendingAsks();

  const cleanupStats = cleanupOrphanedData();
  const totalOrphaned = Object.values(cleanupStats).reduce((sum, v) => sum + v, 0);
  if (totalOrphaned > 0) {
    console.log('[cleanup] Removed orphaned data:', cleanupStats);
  }

  backfillFts(getDatabase());
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
      resolveAskTargetConnections(sessionId, authority).map((conn) => conn.connectionId),
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

  let server: ReturnType<typeof Bun.serve> | undefined;
  let clientLauncher: ClientLauncher | undefined;
  let cleanupPromise: Promise<void> | null = null;
  let onSigterm: (() => void) | undefined;
  let onSigint: (() => void) | undefined;

  const cleanup = (): Promise<void> => {
    if (cleanupPromise !== null) return cleanupPromise;

    cleanupPromise = (async (): Promise<void> => {
      const failures: unknown[] = [];
      const attempt = (operation: () => void): void => {
        try {
          operation();
        } catch (error: unknown) {
          failures.push(error);
        }
      };

      attempt(() => transport.stopTimers());
      attempt(() => application.schedulerTicker.stop());
      attempt(() => stopPushRetryScheduler());
      attempt(() => stopProviderAccountLifecycle());
      attempt(() => clientLauncher?.stop());
      attempt(() => server?.stop());
      attempt(() => getTerminalManager().destroyAllSessions());
      try {
        await disposeJean2ExecutionScope();
      } catch (error: unknown) {
        failures.push(error);
      }
      attempt(() => closeDatabase());
      if (onSigterm) process.removeListener('SIGTERM', onSigterm);
      if (onSigint) process.removeListener('SIGINT', onSigint);

      if (failures.length > 0) {
        throw new AggregateError(failures, 'Server cleanup failed');
      }
    })();
    return cleanupPromise;
  };

  try {
    await initializeJean2ExecutionScope();
    server = Bun.serve({
      port,
      hostname: host,
      ...(tls && { tls }),

      async fetch(req: Request): Promise<Response | undefined> {
        const upgrade = transport.handleUpgrade(req, (data: WsData) => server!.upgrade(req, { data }));
        if (upgrade.handled) {
          return upgrade.response;
        }

        return app.fetch(req);
      },

      websocket: transport.websocket,
    });

    transport.startTimers();

    // Start the scheduler tick loop (catches jobs that became due while offline)
    application.schedulerTicker.start();
    startPushRetryScheduler();
    startProviderAccountLifecycle();

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

    const onShutdown = async (signal: string): Promise<void> => {
      console.log(`Received ${signal}, shutting down...`);
      try {
        await cleanup();
        process.exit(0);
      } catch (error: unknown) {
        console.error('Server cleanup failed:', error);
        process.exit(1);
      }
    };

    onSigterm = () => void onShutdown('SIGTERM');
    onSigint = () => void onShutdown('SIGINT');
    process.on('SIGTERM', onSigterm);
    process.on('SIGINT', onSigint);

    return { server, cleanup };
  } catch (error: unknown) {
    try {
      await cleanup();
    } catch (cleanupError: unknown) {
      console.error('Startup cleanup failed:', cleanupError);
    }
    throw error;
  }
}

if (import.meta.main) {
  startServer().catch((err: unknown) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

export { startServer };
