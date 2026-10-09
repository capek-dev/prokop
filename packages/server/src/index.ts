globalThis.AI_SDK_LOG_WARNINGS = false;

import { readFileSync } from 'fs';

import { createApp } from '@/transport/http/app';
import { createRuntime } from '@/bootstrap/create-runtime';
import { createWiredApplication } from '@/bootstrap/application';
import { installDeliveryPort } from '@/transport/websocket/broadcast';
import { installWireApplication } from '@/transport/websocket/application';
import { resolveAskDeliveryTargets, type AskDeliveryInventories } from '@/domains/controllers';
import { createBunWebSocketAdapter } from '@/transport/websocket/bun-adapter';
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
import { scanTools } from '@/infrastructure/tools/registry';
import { closeDatabase, getDatabase } from '@/infrastructure/sqlite/database';
import { backfillFts } from '@/infrastructure/session-search/fts';
import type { ServerMessage, AskAuthority } from '@prokopai/sdk';
import { getTerminalManager, getTerminalEventManager } from '@/transport/terminal';
import { cleanupRunningSessionsOnStartup } from '@/infrastructure/sqlite/terminal-session-store';
import { reconcileStuckRunningSessions } from '@/infrastructure/sqlite/session-store';
import { reconcileAllSessionsCompaction } from '@/harnesses/prokop/host/compaction-recovery';
import { readEnv } from '@/infrastructure/runtime/env-compat';
import { disposeExecutionLifecycle, initializeExecutionLifecycle } from '@/application/ports/execution-lifecycle';
import { reconcileAllOrphanedToolCalls } from '@/infrastructure/sqlite/message-store';
import { cleanupAllPendingAsks } from '@/infrastructure/sqlite/pending-asks';
import { cleanupOrphanedData } from '@/infrastructure/sqlite/cleanup';
import { getPort } from '@/config';
import { validateToken, isAuthDisabled } from '@/transport/http/middleware/token';
import { createRequestHandler } from '@/transport/request-handler';
import { createListenerSet, type ListenerEndpoint, type ListenerSet } from '@/transport/listeners';
import { createRemoteAccessService, type RemoteAccessService } from '@/application/remote-access/service';
import type { ListenerControl } from '@/application/ports/remote-access';
import { createRemoteAccessSettingsRepository } from '@/infrastructure/sqlite/remote-access-settings';
import { createRemoteAccessNetwork } from '@/infrastructure/network/remote-access-network';
import { updateDaemonPidHost } from '@/infrastructure/daemon';
import { ensurePromptsDir } from '@/config/prompts-registry';
// Static side-effect: OAuth providers register with Capek at module load,
// before any provider lookup (P2 requirement).
import '@/infrastructure/providers';
import {
  getLLMOpenRouterApiKey,
  getLLMMinimaxApiKey,
  getLLMZhipuCodingApiKey,
  getTlsEnabled,
  getTlsCertFile,
  getTlsKeyFile,
  getClientEnabled,
  getLLMDeepseekApiKey,
  getLocalHttpEnabled,
  getLocalHost,
  listenersOverlap,
  resolveTlsPort,
  isLoopbackHost,
  isWildcardHost,
} from '@/infrastructure/runtime/environment';
import { activateSandbox } from '@/infrastructure/sandbox';
import { getEmbeddedClientAssetsRoot } from '@/infrastructure/runtime/client-assets';
import { getOrCreateInstallationId } from '@/infrastructure/runtime/installation-id';
import { buildPairingUrl } from '@/infrastructure/runtime/pairing-urls';
import { startPushRetryScheduler, stopPushRetryScheduler, cleanupPushData } from '@/infrastructure/web-push/retry-scheduler';
import { stopProviderAccountLifecycle } from '@/infrastructure/providers';
import { startStallMonitor } from '@/utils/stall-monitor';

export interface ServerOptions {
  port?: number;
  host?: string;
}

export interface ServerInstance {
  listeners: ListenerSet;
  remoteAccess: RemoteAccessService;
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
  installWireApplication({ session: application.session, control: application.control, providers: application.providers, notifications: application.notifications, permissions: application.permissions, gitStatus: application.files.gitStatusFeed, fileTree: application.files.fileTreeFeed });
  // Every primary/both preconfig becomes an agent on boot: fresh installs
  // ship prokop-code as a real agent and existing installs gain agents for
  // their preconfigs without any user action. Non-fatal: a failed
  // materialization logs and the server still starts.
  try {
    const materialized = await application.agents.ensureAgentsMaterialized();
    if (materialized.length > 0) {
      console.log(`[startup] Materialized ${materialized.length} agent(s): ${materialized.join(', ')}`);
    }
  } catch (error: unknown) {
    console.warn('[startup] Agent materialization failed:', error);
  }
  // One-time migration of home-workspace learning settings into the agent
  // preconfigs, before the learning service starts reading them.
  try {
    const migrated = await application.learning.migrateAgentLearning();
    if (migrated > 0) {
      console.log(`[startup] Migrated learning config for ${migrated} agent(s)`);
    }
  } catch (error: unknown) {
    console.warn('[startup] Agent learning migration failed:', error);
  }
  cleanupRunningSessionsOnStartup();
  const stuckRunningSessions = reconcileStuckRunningSessions();
  if (stuckRunningSessions > 0) {
    console.log(`[startup] Reconciled ${stuckRunningSessions} session(s) stuck in running state`);
  }
  await reconcileAllSessionsCompaction();
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

  console.log('Starting AI Agent Server...');

  const transport = createBunWebSocketAdapter({
    terminal: {
      getManager: () => getTerminalManager(),
      getEventManager: () => getTerminalEventManager(),
    },
    resolveAskTargets: (sessionId: string, authority: AskAuthority): ConnectionId[] =>
      resolveAskTargetConnections(sessionId, authority).map((conn) => conn.connectionId),
    onConnectionClosed: (connectionId) => {
      application.files.gitStatusFeed.disconnect(connectionId);
      application.files.fileTreeFeed.disconnect(connectionId);
    },
  });
  installDeliveryPort(transport.delivery);
  application.deviceAccess.subscribe({
    deviceRevoked: (deviceId) => transport.closeDeviceSockets(deviceId),
  });

  const availableProviders: string[] = [];
  if (getLLMOpenRouterApiKey()) availableProviders.push('openrouter');
  if (getLLMMinimaxApiKey()) availableProviders.push('minimax');
  if (getLLMZhipuCodingApiKey()) availableProviders.push('zhipu-coding');
  if (getLLMDeepseekApiKey()) availableProviders.push('deepseek');

  if (availableProviders.length > 0) {
    console.log(`Available providers: ${availableProviders.join(', ')}`);
  } else {
    console.warn('WARNING: No LLM API keys configured. Chat will not work.');
    console.warn('Set at least one of: JEAN2_LLM_OPENROUTER_API_KEY, JEAN2_LLM_MINIMAX_API_KEY, JEAN2_LLM_ZHIPU_CODING_API_KEY, JEAN2_LLM_DEEPSEEK_API_KEY');
  }

  console.log('Scanning for tools...');
  const tools = await scanTools();
  console.log(`Found ${tools.length} tools: ${tools.map(t => t.definition.name).join(', ')}`);

  // Remote access decides the bind address (unless PROKOPAI_HOST or --host does)
  // and controls the listeners created below; `listenerControl` is late-bound.
  const remoteAccess = createRemoteAccessService({
    repository: createRemoteAccessSettingsRepository(getDatabase),
    network: createRemoteAccessNetwork(),
    environment: {
      bindOverride: options?.host ?? readEnv('HOST') ?? null,
      extraHosts: (readEnv('ALLOWED_HOSTS') ?? '').split(',').map((entry) => entry.trim()).filter(Boolean),
    },
    listeners: () => listenerControl,
    onChanged: () => transport.delivery.broadcast({ type: 'access.changed' }),
    onNetworkListeningDisabled: () => transport.closeNetworkSockets(),
  });
  const host = remoteAccess.bindHost();

  const app = createApp(application, {
    installationId: getOrCreateInstallationId(),
    remoteAccess,
    pairingLinks: (code) => remoteAccess.pairingBaseUrls().map((baseUrl) => buildPairingUrl(baseUrl, code)),
  });

  if (readEnv('SANDBOX') === 'true') {
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

  let localHttpEnabled = getLocalHttpEnabled();
  const localHost = getLocalHost();
  const tlsPort = tls ? resolveTlsPort(host, port, localHttpEnabled) : undefined;

  if (readEnv('LOCAL_HTTP') === 'true' && !tls) {
    console.warn('WARNING: PROKOPAI_LOCAL_HTTP=true has no effect when TLS is disabled; the main listener is already plain HTTP.');
  }

  console.log(`Server starting on ${protocol}://${host}:${tlsPort ?? port}`);

  if (localHttpEnabled && tlsPort === port && listenersOverlap(host, localHost)) {
    console.error(`ERROR: TLS listener (${host}:${tlsPort}) overlaps the local HTTP listener (${localHost}:${port}); set PROKOPAI_TLS_PORT, bind PROKOPAI_HOST to a specific address, or disable the local listener with PROKOPAI_LOCAL_HTTP=false.`);
    localHttpEnabled = false;
  } else if (localHttpEnabled) {
    console.log(`[local] HTTP listener on http://${localHost}:${port}`);
  }

  const handleRequest = createRequestHandler({
    app,
    transport,
    deviceAccess: application.deviceAccess,
    validateLegacyToken: validateToken,
    isAuthDisabled,
    isKnownHostname: (hostname) => remoteAccess.isKnownHostname(hostname),
  });

  const listeners = createListenerSet({ fetch: handleRequest, websocket: transport.websocket });
  const mainEndpointFor = (bindHost: string): ListenerEndpoint => ({
    hostname: bindHost,
    port: tls ? resolveTlsPort(bindHost, port, localHttpEnabled) : port,
    ...(tls && { tls }),
  });
  const listenerControl: ListenerControl = {
    endpoint: () => {
      const main = listeners.main() ?? mainEndpointFor(host);
      return { host: main.hostname, port: main.port, protocol };
    },
    loopbackTarget: () => {
      const local = listeners.local();
      if (local) return `http://${local.hostname}:${local.port}`;
      const main = listeners.main() ?? mainEndpointFor(host);
      const target = isLoopbackHost(main.hostname) || isWildcardHost(main.hostname) ? '127.0.0.1' : main.hostname;
      return tls ? `https+insecure://${target}:${main.port}` : `http://${target}:${main.port}`;
    },
    rebind: async (bindHost) => {
      listeners.rebindMain(mainEndpointFor(bindHost));
      updateDaemonPidHost(bindHost);
      const main = listeners.main()!;
      console.log(`[listen] Now listening on ${protocol}://${main.hostname}:${main.port}`);
    },
  };
  let cleanupPromise: Promise<void> | null = null;
  const stopStallMonitor = startStallMonitor();
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

      try { await application.learning.stop(); }
      catch (error: unknown) { failures.push(error); }
      attempt(() => transport.shutdown());
      attempt(() => stopStallMonitor());
      attempt(() => application.schedulerTicker.stop());
      attempt(() => stopPushRetryScheduler());
      attempt(() => stopProviderAccountLifecycle());
      attempt(() => listeners.stop());
      attempt(() => application.deviceAccess.dispose());
      attempt(() => application.attention.dispose());
      attempt(() => getTerminalManager().destroyAllSessions());
      try {
        await disposeExecutionLifecycle();
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
    await initializeExecutionLifecycle();
    // Recovery and subscription are complete before accepting HTTP mutations.
    await application.learning.start();
    listeners.start(mainEndpointFor(host), localHttpEnabled ? { hostname: localHost, port } : null);
    // The machine's Tailscale name is trusted for `tailscale serve`; detection must not delay startup.
    void remoteAccess.refreshTailscale().catch((error: unknown) => console.warn('[remote-access] Tailscale detection failed:', error));

    transport.startTimers();

    // Start the scheduler tick loop (catches jobs that became due while offline)
    application.schedulerTicker.start();
    startPushRetryScheduler();

    const clientAssetsRoot = getEmbeddedClientAssetsRoot();
    if (clientAssetsRoot !== null) {
      const clientHost = host === '0.0.0.0' ? 'localhost' : host;
      console.log(`[client] Running at ${protocol}://${clientHost}:${tlsPort ?? port}`);
      if (listeners.local()) {
        console.log(`[client] Running locally at http://${localHost}:${port}`);
      }
    } else if (getClientEnabled()) {
      console.log('[client] Embedded client assets unavailable in source development (use `bun run dev:remote` to serve a built client for other devices)');
    } else {
      console.log('[client] Built-in client disabled (PROKOPAI_CLIENT_ENABLED=false)');
    }

    console.log(`AI Agent Server running at ${protocol}://${host}:${tlsPort ?? port}`);

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

    return { listeners, remoteAccess, cleanup };
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
