import {
  createAgentsApplication,
  createFilesApplication,
  createMcpHttpApplication,
  createProvidersApplication,
  createSchedulingHttpApplication,
  createSchedulingTicker,
  createSessionApplication,
  createSessionControlApplication,
  createSessionHttpApplication,
  createToolsHttpApplication,
  createWorkspaceApplication,
  createPermissionsApplication,
  createConfigurationApplication,
  createMaintenanceApplication,
  createResponseFormatsApplication,
  type AgentsApplication,
  type FilesApplication,
  type McpHttpApplication,
  type NotificationsApplication,
  type PermissionsApplication,
  type ProvidersApplication,
  type SchedulingHttpApplication,
  type SchedulingTicker,
  type SessionApplication,
  type SessionControlApplication,
  type SessionHttpApplication,
  type ToolsHttpApplication,
  type WorkspaceApplication,
  type ConfigurationApplication,
  type MaintenanceApplication,
  type ResponseFormatsApplication,
} from '@/application';
import {
  configureJean2AgentSource,
  createJean2AskAuthorityPort,
  configureJean2PreconfigSource,
  createJean2ProviderRegistryPort,
  createJean2SessionExecution,
  jean2StorageBundle,
} from '@/adapters/capek';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import {
  createJean2AgentPreconfigPort,
  createJean2AgentWorkspacePort,
  createJean2FilesApplicationPort,
  createJean2McpLifecyclePort,
  createJean2McpWorkspacePort,
  createJean2OAuthFlowPort,
  createJean2PendingAskPort,
  createJean2PermissionRepositoryPort,
  createJean2ConfigurationPorts,
  createJean2MaintenanceApplication,
  createJean2ResponseFormatsApplication,
  createJean2ProviderCredentialPort,
  createJean2ScheduledJobExecution,
  createJean2ScheduledJobRepository,
  createJean2SessionRepository,
  createJean2ToolCatalogPort,
  createJean2ToolEnvironmentPort,
  createJean2WorkspaceCleanupPort,
  getJean2NotificationsApplication,
  createJean2WorkspaceDirectoryPort,
  createJean2WorkspacePathConfigPort,
  createJean2WorkspacePinnedPort,
  createJean2WorkspaceRepositoryPort,
  createJean2WorkspaceSessionListingPort,
  createJean2WorkspaceTerminalPort,
} from '@/adapters/jean2';
import { installTerminalSessionStore } from '@/transport/terminal';
import { createJean2TerminalSessionPort } from '@/adapters/jean2/terminal';
import { createTransportControllerPorts } from '@/transport/websocket/control-port';
import { getAutoApproveTakeover } from '@/infrastructure/runtime/environment';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { createAgentDirectoryPort } from '@/infrastructure/agents/agent-directory-filesystem';
import { getDataDir } from '@/infrastructure/runtime/paths';

export interface WiredApplication {
  session: SessionApplication<ConnectionId>;
  control: SessionControlApplication<ConnectionId>;
  http: SessionHttpApplication;
  scheduling: SchedulingHttpApplication;
  /** The wired scheduled-job tick loop owned by the application composition. */
  schedulerTicker: SchedulingTicker;
  /** The wired agent promotion, home, and memory use cases (S4). */
  agents: AgentsApplication;
  /** The wired workspace record and cleanup use cases (S4). */
  workspaces: WorkspaceApplication;
  /** The wired tools catalog and environment use cases (S4). */
  tools: ToolsHttpApplication;
  /** The wired MCP lifecycle use cases (S5). */
  mcp: McpHttpApplication;
  /** The wired provider account and OAuth use cases (S4). */
  providers: ProvidersApplication;
  /** The wired notification reservation and delivery use cases (S4). */
  notifications: NotificationsApplication;
  /** The wired permission grant application. */
  permissions: PermissionsApplication;
  /** The wired files list/search/preview/edit/git use cases (S5). */
  files: FilesApplication;
  /** The wired configuration use cases (S9). */
  configuration: ConfigurationApplication;
  maintenance: MaintenanceApplication;
  responseFormats: ResponseFormatsApplication;
}

/**
 * Wired application composition (S3, extended by the S4 scheduling slice).
 *
 * Assembles the session and control use cases with concrete Jean2 ports:
 * the store-backed repository adapter, the Capek compat execution adapter,
 * the transport-owned controller gate and control registry, and the current
 * takeover configuration. The S4 scheduling slice adds the scheduled-job
 * HTTP use cases and the tick loop over the store-backed scheduled-job
 * repository adapter, the storage workspace lookup, and the current runner
 * execution adapter. The composed ticker is returned for direct startup and
 * shutdown lifecycle calls; use cases never import store or Capek
 * implementations themselves.
 */
export function createWiredAgentsApplication(): AgentsApplication {
  return createAgentsApplication({
    dataDir: () => getDataDir(),
    directory: createAgentDirectoryPort(),
    workspaces: createJean2AgentWorkspacePort(),
    preconfigs: createJean2AgentPreconfigPort(),
  });
}

export function createWiredApplication(existingAgents?: AgentsApplication): WiredApplication {
  const agents = existingAgents ?? createWiredAgentsApplication();
  configureJean2PreconfigSource(agents);
  configureJean2AgentSource(agents);

  const repository = createJean2SessionRepository(agents);
  const execution = createJean2SessionExecution();
  const askAuthority = createJean2AskAuthorityPort();
  const pendingAsks = createJean2PendingAskPort();
  const transportControl = createTransportControllerPorts();

  const session = createSessionApplication<ConnectionId>({
    repository,
    execution,
    gate: transportControl.gate,
    control: transportControl.control,
    pendingAsks,
    askAuthority,
  });

  const control = createSessionControlApplication<ConnectionId>({
    control: transportControl.control,
    autoApproveTakeover: getAutoApproveTakeover,
  });

  const http = createSessionHttpApplication(repository);

  const schedulingRepository = createJean2ScheduledJobRepository();
  const schedulingExecution = createJean2ScheduledJobExecution();

  const scheduling = createSchedulingHttpApplication({
    repository: schedulingRepository,
    workspaces: {
      getWorkspace,
    },
    execution: schedulingExecution,
  });

  const schedulerTicker = createSchedulingTicker({
    repository: schedulingRepository,
    execution: schedulingExecution,
  });

  const workspaces = createWorkspaceApplication({
    repository: createJean2WorkspaceRepositoryPort(),
    sessions: createJean2WorkspaceSessionListingPort(),
    pinned: createJean2WorkspacePinnedPort(),
    terminals: createJean2WorkspaceTerminalPort(),
    cleanup: createJean2WorkspaceCleanupPort(),
    directory: createJean2WorkspaceDirectoryPort(),
    paths: createJean2WorkspacePathConfigPort(),
  });

  const tools = createToolsHttpApplication({
    catalog: createJean2ToolCatalogPort(),
    environment: createJean2ToolEnvironmentPort(),
  });

  const mcp = createMcpHttpApplication({
    lifecycle: createJean2McpLifecyclePort(),
    workspaces: createJean2McpWorkspacePort(),
  });

  const providers = createProvidersApplication({
    registry: createJean2ProviderRegistryPort(),
    oauth: createJean2OAuthFlowPort(),
    credentials: createJean2ProviderCredentialPort(),
  });

  const notifications = getJean2NotificationsApplication();

  const permissions = createPermissionsApplication({
    repository: createJean2PermissionRepositoryPort(),
  });

  const files = createFilesApplication(createJean2FilesApplicationPort());
  const configuration = createConfigurationApplication(createJean2ConfigurationPorts());
  const maintenance = createMaintenanceApplication(createJean2MaintenanceApplication());
  const responseFormats = createResponseFormatsApplication(createJean2ResponseFormatsApplication());

  installTerminalSessionStore(createJean2TerminalSessionPort());

  return { session, control, http, scheduling, schedulerTicker, agents, workspaces, tools, mcp, providers, notifications, permissions, files, configuration, maintenance, responseFormats };
}
