import { existsSync } from 'node:fs';
import {
  createAgentsApplication,
  createFilesApplication,
  createMcpHttpApplication,
  createProvidersApplication,
  createSchedulingHttpApplication,
  createSchedulingTicker,
  withScheduledJobChangeNotices,
  createSessionApplication,
  createSessionControlApplication,
  createSessionHttpApplication,
  createSessionTitleRegeneration,
  createToolsHttpApplication,
  createWorkspaceApplication,
  createWorktreeApplication,
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
  type WorktreeApplication,
  type ConfigurationApplication,
  type MaintenanceApplication,
  type ResponseFormatsApplication,
} from '@/application';
import {
  configureJean2AgentSource,
  createJean2AskAuthorityPort,
  configureJean2PreconfigSource,
  createJean2ProviderRegistryPort,
  jean2TitleBindings,
} from '@/adapters/capek';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { listPreconfigs } from '@/infrastructure/config/preconfig';
import { spawnCodexAppServer } from '@/harnesses/codex-cli/app-server';
import { agentSkillsDomainTools, memoryDomainTools, sessionSearchDomainTools } from '@/adapters/capek/domain-tools';
import { createPretoolChannel } from '@/harnesses/codex-cli/pretool-hook';
import { selectEmptySessionHarnessModel } from '@/infrastructure/sqlite/session-store';
import { getModelsConfigWithStatus } from '@/config/models';
import { findModelVariantKeys } from '@/config';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import { countMessagesInSession } from '@/infrastructure/sqlite/message-store';
import { createWorktreeGitPort } from '@/infrastructure/git-worktrees';
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
import { getTerminalManager, installTerminalSessionStore } from '@/transport/terminal';
import { broadcastEvent, broadcastSessionUpdated, sendToConnectionEvent } from '@/transport/websocket/broadcast';
import { addWorkspaceFilesChangedObserver } from '@/application/workspaces/files-changed';
import { getWorkspaceTools, setMcpChangeListener } from '@/infrastructure/mcp';
import { browserService } from '@/infrastructure/browser/service';
import { installBrowserRequestsPort } from '@/application/ports/browser';
import { listWorkspaces } from '@/infrastructure/sqlite/workspaces';
import { createJean2TerminalSessionPort } from '@/adapters/jean2/terminal';
import { createTransportControllerPorts } from '@/transport/websocket/control-port';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { createAgentDirectoryPort } from '@/infrastructure/agents/agent-directory-filesystem';
import { getDataDir } from '@/infrastructure/runtime/paths';
import { codexAccounts } from '@/infrastructure/providers/codex-accounts';
import { codexAccountRuntime } from '@/infrastructure/providers/codex';
import { createCodexAccountUsagePort } from '@/infrastructure/providers/codex-usage';
import { createProviderUsagePort } from '@/infrastructure/providers/usage';
import { getLLMApiKeys } from '@/infrastructure/runtime/environment';
import { createProkopHarness } from '@/harnesses/prokop';
import { prokopAskResolution } from '@/harnesses/prokop/composition/contracts';
import { createProkopLearningRuntime } from '@/harnesses/prokop/learning';
import { codexApprovals } from '@/harnesses/codex-cli/approvals';
import { installCodexApprovalPort } from '@/application/ports/codex-approval';
import { installHarnessNotificationPort } from '@/application/ports/harness-notifications';
import { claudeApprovals } from '@/harnesses/claude-cli/approvals';
import { installClaudeApprovalPort } from '@/application/ports/claude-approval';
import { installAskResolutionPort } from '@/application/ports/ask-resolution';
import {
  codexCliAvailable,
  codexCliVersion,
  createCodexCliHarness,
  createCodexExecution,
  getCodexModelSelection,
  listCachedCodexModels,
  readCachedCodexUsageLimits,
  saveCodexModelSelection,
} from '@/harnesses/codex-cli';
import { createHarnessExecution, type HarnessRegistration } from '@/application/sessions/harness-execution';
import { installHeadlessExecutionPort } from '@/application/ports/headless-execution';
import { claudeCliAvailable, claudeCliVersion, createClaudeCliHarness, createClaudeExecution,
  getClaudeModelSelection, listCachedClaudeModels, readCachedClaudeUsageLimits,
  saveClaudeModelSelection } from '@/harnesses/claude-cli';
import { createHarnessSettingsApplication } from '@/application/harnesses/settings';
import { createServerSettingsRepository } from '@/infrastructure/sqlite/server-settings';

import { createWiredLearning } from './learning';

export interface WiredApplication {
  learning: ReturnType<typeof createWiredLearning>;
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
  /** Managed session worktree lifecycle and binding use cases. */
  worktrees: WorktreeApplication;
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
  installBrowserRequestsPort(browserService);
  setMcpChangeListener(path => {
    if (path === null) {
      broadcastEvent({ type: 'mcp.changed', workspaceId: null });
      return;
    }
    for (const workspace of listWorkspaces()) {
      if (workspace.path === path) broadcastEvent({ type: 'mcp.changed', workspaceId: workspace.id });
    }
  });
  const agents = existingAgents ?? createWiredAgentsApplication();
  configureJean2PreconfigSource(agents);
  configureJean2AgentSource(agents);

  const repository = createJean2SessionRepository(agents);
  // Universal server-side title generation shared by the external harnesses;
  // the Prokop harness keeps its Capek implementation.
  const sessionTitleRegeneration = createSessionTitleRegeneration({ repository, titles: jean2TitleBindings });
  let refreshWorktreeAttachments: ((worktreeId: string) => void) | null = null;
  const worktreeAttachments = {
    changed: (worktreeId: string): void => refreshWorktreeAttachments?.(worktreeId),
  };
  installCodexApprovalPort(codexApprovals);
  const notificationApplication = getJean2NotificationsApplication();
  installHarnessNotificationPort({
    notifyTerminalMessage: (message, sessionId) => notificationApplication.notifyTerminalMessage(message, sessionId),
    notifyPermissionRequired: (requestId, rootSessionId) =>
      notificationApplication.notifyPermissionRequired(requestId, rootSessionId),
  });
  installClaudeApprovalPort(claudeApprovals);
  // The prokop composition owns the ask waiters; wire-side resolution must
  // land in the same composed permission runtime execution enters.
  installAskResolutionPort(prokopAskResolution);
  const codexExecution = createCodexExecution({
    mcp: { tools: getWorkspaceTools },
    connect: spawnCodexAppServer,
    version: codexCliVersion,
    prepareHook: createPretoolChannel,
    memoryTools: memoryDomainTools,
    sessionSearch: sessionSearchDomainTools,
    agentSkills: agentSkillsDomainTools,
    instructions: {
      listPreconfigs,
      getPreconfig: id => agents.getPreconfigOrAgent(id),
      getAgentDirectory: id => agents.getAgentDirectory(id),
      readAgentMemoryFile: (id, filename) => agents.readAgentMemoryFile(id, filename),
    },
  });
  const claudeExecution = createClaudeExecution({
    mcp: { tools: getWorkspaceTools },
    instructions: {
      listPreconfigs,
      getPreconfig: id => agents.getPreconfigOrAgent(id),
      getAgentDirectory: id => agents.getAgentDirectory(id),
      readAgentMemoryFile: (id, filename) => agents.readAgentMemoryFile(id, filename),
    },
    memoryTools: memoryDomainTools,
    sessionSearch: sessionSearchDomainTools,
    agentSkills: agentSkillsDomainTools,
  });
  const harnessRegistrations: Record<import('@prokopai/sdk').SessionHarness, HarnessRegistration> = {
    prokop: createProkopHarness({
      onSessionChanged: (changedSession) => {
        if (changedSession.workspaceRootId) {
          worktreeAttachments.changed(changedSession.workspaceRootId);
        }
      },
    }),
    'codex-cli': createCodexCliHarness(codexExecution, sessionTitleRegeneration),
    'claude-cli': createClaudeCliHarness(claudeExecution, sessionTitleRegeneration),
  };
  const execution = createHarnessExecution(repository, harnessRegistrations);
  // Headless (scheduled) dispatch routes through the harness registry: the
  // Prokop registration owns the composed-scope child run; harnesses
  // without headless support fail closed per run and are rejected at job
  // creation through supportedHarnesses().
  installHeadlessExecutionPort({
    run(input) {
      const headless = harnessRegistrations[input.harness]?.headless;
      return headless
        ? headless(input)
        : Promise.resolve({ error: `Scheduled jobs are not supported for ${input.harness} sessions` });
    },
    supportedHarnesses() {
      return (Object.keys(harnessRegistrations) as Array<import('@prokopai/sdk').SessionHarness>)
        .filter(harness => harnessRegistrations[harness].headless !== undefined);
    },
  });
  const askAuthority = createJean2AskAuthorityPort();
  const pendingAsks = createJean2PendingAskPort();
  const transportControl = createTransportControllerPorts();
  const toolCatalog = createJean2ToolCatalogPort();
  const managedWorktrees = createManagedWorktreeRepository(getDatabase);
  const harnessSettings = createHarnessSettingsApplication(createServerSettingsRepository(getDatabase));
  const codexWorkspaceAvailable = (workspaceId: string): boolean => {
    const workspace = getWorkspace(workspaceId);
    return Boolean(workspace && !workspace.isVirtual && workspace.path && existsSync(workspace.path));
  };
  const workspaceRoots = {
    isAvailable(workspaceId: string, workspaceRootId: string): boolean {
      const worktree = managedWorktrees.get(workspaceRootId);
      return worktree?.workspaceId === workspaceId && worktree.state === 'available';
    },
  };
  const worktreeRoots = {
    listAvailablePaths: (workspaceId: string): string[] => managedWorktrees.listByWorkspace(workspaceId)
      .filter((worktree) => worktree.state === 'available')
      .map((worktree) => worktree.path),
    getAvailablePath: (workspaceId: string, worktreeId: string): string | null => {
      const worktree = managedWorktrees.get(worktreeId);
      return worktree?.workspaceId === workspaceId && worktree.state === 'available'
        ? worktree.path
        : null;
    },
  };

  const session = createSessionApplication<ConnectionId>({
    repository,
    execution,
    gate: transportControl.gate,
    control: transportControl.control,
    pendingAsks,
    askAuthority,
    toolCatalog,
    workspaceRoots,
    worktreeAttachments,
    codexAvailable: codexCliAvailable,
    codexWorkspaceAvailable,
    claudeAvailable: claudeCliAvailable,
    claudeWorkspaceAvailable: codexWorkspaceAvailable,
    claudeModels: listCachedClaudeModels,
    codexModels: listCachedCodexModels,
    saveHarnessModelSelection: (sessionId, selection) => {
      if (selection.harness === 'codex-cli') saveCodexModelSelection(sessionId, selection);
      else saveClaudeModelSelection(sessionId, selection);
    },
    isHarnessDisabled: harnessSettings.isDisabled,
    prokopModelAvailable: (modelId, providerId) => getModelsConfigWithStatus().providers
      .some(provider => provider.id === providerId && provider.models.some(model => model.id === modelId && model.runtimeStatus.usable)),
    modelVariantKeys: findModelVariantKeys,
    selectEmptySessionHarnessModel,
  });

  const control = createSessionControlApplication<ConnectionId>({
    control: transportControl.control,
  });

  const http = createSessionHttpApplication(
    repository,
    toolCatalog,
    workspaceRoots,
    worktreeAttachments,
    codexCliAvailable,
    codexWorkspaceAvailable,
    { list: listCachedCodexModels, get: getCodexModelSelection, save: saveCodexModelSelection,
      isActive: codexExecution.isSessionActive },
    claudeCliAvailable,
    { list: listCachedClaudeModels, get: getClaudeModelSelection, save: saveClaudeModelSelection,
      isActive: claudeExecution.isSessionActive },
    codexWorkspaceAvailable,
    { settings: harnessSettings, codexVersion: codexCliVersion, claudeVersion: claudeCliVersion,
      usage: { 'codex-cli': readCachedCodexUsageLimits, 'claude-cli': readCachedClaudeUsageLimits } },
    {
      created: (session) => broadcastEvent({ type: 'session.created', session }),
      updated: broadcastSessionUpdated,
      deleted: (sessionId) => broadcastEvent({ type: 'session.deleted', sessionId }),
    },
  );

  // Every job write (edits, runs, errors, schedule advances) tells clients to refetch that workspace's jobs.
  const schedulingRepository = withScheduledJobChangeNotices(createJean2ScheduledJobRepository(),
    (workspaceId) => broadcastEvent({ type: 'scheduler.changed', workspaceId }));
  // Scheduled runs create sessions outside any connection; announce them to every client.
  const schedulingExecution = createJean2ScheduledJobExecution({
    announceSession: broadcastSessionUpdated,
    runs: schedulingRepository,
  });

  const scheduling = createSchedulingHttpApplication({
    repository: schedulingRepository,
    workspaces: {
      getWorkspace,
    },
    execution: schedulingExecution,
    isHarnessDisabled: harnessSettings.isDisabled,
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
    worktreeRoots,
  });

  const worktrees = createWorktreeApplication({
    dataDir: () => getDataDir(),
    repository: managedWorktrees,
    git: createWorktreeGitPort(),
    workspaces: { get: getWorkspace },
    sessions: {
      get: (id) => repository.getSession(id),
      listByWorkspace: (workspaceId) => repository.listSessionsByWorkspace(workspaceId),
      updateWorkspaceRoot: (id, workspaceRootId) => repository.updateSession(id, { workspaceRootId }),
      hasMessages: (sessionId) => countMessagesInSession(sessionId) > 0,
      isRunning: (candidate) => Boolean(candidate.runningAt || candidate.subagentStatus === 'running'),
    },
    terminals: {
      listForWorktree: (worktreeId, path) => getTerminalManager().listSessionsForWorktree(worktreeId, path),
      clearWorktreeReferences: (worktreeId) => getTerminalManager().clearWorktreeReferences(worktreeId),
    },
    events: {
      worktreeChanged: (worktree) => broadcastEvent({ type: 'worktree.updated', worktree }),
      worktreeDeleted: (worktree) => broadcastEvent({ type: 'worktree.deleted', worktree }),
      sessionChanged: broadcastSessionUpdated,
    },
  });
  refreshWorktreeAttachments = (worktreeId) => {
    void worktrees.refreshAttachments(worktreeId);
  };

  const tools = createToolsHttpApplication({
    catalog: toolCatalog,
    environment: createJean2ToolEnvironmentPort(),
  });

  const mcp = createMcpHttpApplication({
    lifecycle: createJean2McpLifecyclePort(),
    workspaces: createJean2McpWorkspacePort(),
  });

  codexAccounts.setChangeListener(status => broadcastEvent({
    type: 'provider.status', provider: 'codex', connected: status.connected,
    reauthRequired: status.reauthRequired,
  }));
  const providers = createProvidersApplication({
    usage: createProviderUsagePort({ getKey: provider => getLLMApiKeys()[provider] }),
    registry: createJean2ProviderRegistryPort(),
    oauth: createJean2OAuthFlowPort(),
    credentials: createJean2ProviderCredentialPort(),
    accounts: codexAccounts,
    codexUsage: createCodexAccountUsagePort({ accounts: codexAccounts, runtime: codexAccountRuntime }),
  });

  const notifications = getJean2NotificationsApplication();

  const permissions = createPermissionsApplication({
    repository: createJean2PermissionRepositoryPort(),
  });

  const files = createFilesApplication(createJean2FilesApplicationPort({
    listAvailableWorktreePaths: worktreeRoots.listAvailablePaths,
  }), (workspaceId, root) => broadcastEvent({ type: 'git.changed', workspaceId, root }), {
    deliverGitStatus: (subscriber, message) => sendToConnectionEvent(subscriber as ConnectionId, message),
    deliverFileTree: (subscriber, message) => sendToConnectionEvent(subscriber as ConnectionId, message),
  });
  // Tool completions that may write files refresh subscribed Git status and trees, throttled per root.
  addWorkspaceFilesChangedObserver((workspaceId) => files.gitStatusFeed.filesChanged(workspaceId));
  addWorkspaceFilesChangedObserver((workspaceId) => files.fileTreeFeed.filesChanged(workspaceId));
  const configuration = createConfigurationApplication({
    ...createJean2ConfigurationPorts(),
    // Primary/both preconfigs materialize as agents on save. Materialization
    // failure must not fail an otherwise-successful config write.
    onPreconfigSaved: async (preconfigId) => {
      try {
        await agents.ensureAgentMaterialized(preconfigId);
      } catch (error: unknown) {
        console.warn(`[agents] Failed to materialize agent for preconfig ${preconfigId}:`, error);
      }
    },
  });
  const maintenance = createMaintenanceApplication(createJean2MaintenanceApplication());
  const responseFormats = createResponseFormatsApplication(createJean2ResponseFormatsApplication());

  installTerminalSessionStore(createJean2TerminalSessionPort());

  return { learning: createWiredLearning(agents, createProkopLearningRuntime({ agents }), {
    // Harness-pinned reviewers resolve their effort from the cached CLI
    // catalogs (unsupported pinned effort falls back to the model default);
    // a missing CLI or model yields null and the cycle skips silently.
    harnessModelEffort: async (harness, model, variant) => {
      try {
        const models = harness === 'codex-cli' ? await listCachedCodexModels() : await listCachedClaudeModels();
        const entry = models.find(candidate => candidate.model === model);
        if (!entry) return null;
        return entry.supportedEfforts.includes(variant ?? '') ? variant! : entry.defaultEffort;
      } catch {
        return null;
      }
    },
    saveHarnessSelection: (harness, sessionId, model, effort) => {
      if (harness === 'codex-cli') saveCodexModelSelection(sessionId, { model, effort });
      else saveClaudeModelSelection(sessionId, { model, effort });
    },
  }), session, control, http, scheduling, schedulerTicker, agents, workspaces, worktrees, tools, mcp, providers, notifications, permissions, files, configuration, maintenance, responseFormats };
}
