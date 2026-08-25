/**
 * C5 session-search domain slice characterization.
 *
 * Pins the composed and unscoped behavior after the independent-review
 * repairs: composed execution uses the scope-captured host and storage
 * services with one shared availability predicate; permission risk and
 * includeToolResults flow through unchanged; enabled and disabled settings
 * gate the tool and the guidance together inside the same composed scope;
 * the unscoped fallback is installed explicitly, never by module load; and
 * facade and current composed context stay byte-identical to the fixed
 * legacy builder.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Preconfig, Workspace } from '@capekai/types';
import { createDefaultRuntimeConfiguration } from '../src/configuration/defaults';
import { configureRuntimeConfiguration } from '../src/configuration/runtime';
import {
  getContextAssembler,
  type ContextAssemblyData,
} from '../src/context/assembler';
import {
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
} from '../src/context/sources';
import { buildAiSdkTools } from '../src/core/build-tools';
import { createAgentScope } from '../src/kernel/kernel';
import type { CapekPlugin, PluginContext } from '../src/kernel/types';
import { createComposition, enterAgentScope } from '../src/plugins/compose';
import { createCurrentAgentScope, createCurrentProcessScope } from './helpers/composition';
import { CURRENT_CONTEXT_SECTION_IDS } from '../src/plugins/context-sections';
import { currentAgentPlugins } from './helpers/composition';
import { buildSystemMessage } from '../src/plugins/legacy-system-message';
import {
  CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID,
  capekSchedulerDomainKey,
} from '../src/plugins/scheduler-domain';
import {
  CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID,
  capekSessionSearchDomainKey,
  installSessionSearchToolFallback,
} from '../src/plugins/session-search-domain';
import { CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID } from '../src/plugins/subagent-domain';
import { CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID } from '../src/plugins/workflow-domain';
import { CURRENT_MEMORY_DOMAIN_PLUGIN_ID } from '../src/plugins/memory-domain';
import { CURRENT_SKILLS_DOMAIN_PLUGIN_ID } from '../src/plugins/skills-domain';
import { resetProviders } from '../src/providers/registry';
import {
  resetDomainToolFallbacksForTests,
  DOMAIN_TOOL_PAYLOAD_FIELD,
  getContributedDomainToolPayloads,
  getDomainToolFallback,
} from '../src/runtime/domain-tool-source';
import { configureRuntimeHost, type PendingAskRecord, type RuntimeHost } from '../src/runtime/host';
import { SandboxController } from '../src/sandbox/controller';
import { configureSchedulerHost, type SchedulerHost } from '../src/scheduler/host';
import {
  configureSessionSearchHost,
  SESSION_SEARCH_GUIDANCE,
  type SearchMessageResult,
  type SessionSearchHost,
} from '../src/session-search';
import { createInMemoryStorageBundle } from '../src/storage/memory';
import type { StorageBundle } from '../src/storage/contracts';
import { configureStorage } from '../src/storage/runtime';
import { resolvePermission } from '../src/permission/permission-request-manager';
import { clearCache } from '../src/tools/registry';
import { configureWorkspaceToolDiscovery } from '../src/tools/tool-source';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const roots: string[] = [];

async function tempDir(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `capek-c5-search-${label}-`));
  roots.push(path);
  return path;
}

function minimalHost(): RuntimeHost {
  return {
    interaction: {
      createPendingAsk: async () => 'pending',
      removePendingAsk: async () => {},
      removePendingAsksByToolCallId: async () => {},
      getPermissionRequestByRequestId: async () => null,
      resolvePermissionRequestByRequestId: async () => false,
      expirePermissionRequest: async () => false,
      expireOldPermissionRequests: async () => 0,
      cancelPendingRequestsBySession: async () => 0,
      listPendingAsksBySession: async () => [],
      listPendingAsksByRootSession: async () => [],
      listPendingRequestsByRootSession: async () => [],
      matchGrant: async () => ({ matched: false, grant: null }),
      createGrantFromOptions: async () => null,
      getSessionAutoApproveSeverity: async () => undefined,
      getPermissionTimeoutMs: () => 30 * 60 * 1000,
      notifyPermissionRequired: async () => {},
    },
    delivery: { emit: () => {} },
    titles: {
      isDefaultSessionTitle: () => true,
      hasManualSessionTitle: () => false,
      generateSessionTitle: async () => null,
    },
    workspace: {
      createToolWorkspaceHost: () => ({
        root: '/tmp',
        additionalRoots: undefined,
        allowedRoots: [],
        tempDir: '/tmp/capek-c5-search-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

/** Interaction host whose pending records survive long enough for
 * `resolvePermission` to observe and resolve them. */
function permissionAwareHost(): RuntimeHost {
  const base = minimalHost();
  const records = new Map<string, PendingAskRecord>();
  return {
    ...base,
    interaction: {
      ...base.interaction,
      createPendingAsk: async (record) => {
        const id = `pending-${records.size}`;
        records.set(record.requestId, { ...record, id });
        return id;
      },
      getPermissionRequestByRequestId: async (requestId) => records.get(requestId) ?? null,
      resolvePermissionRequestByRequestId: async (requestId, status) => {
        const record = records.get(requestId);
        if (record) record.status = status;
        return Boolean(record);
      },
      expirePermissionRequest: async (requestId) => records.delete(requestId),
    },
  };
}

function minimalSchedulerHost(): SchedulerHost {
  return {
    create: () => {
      throw new Error('not configured');
    },
    get: () => null,
    list: () => [],
    update: () => null,
    delete: () => false,
    trigger: () => {},
  };
}

function searchHost(overrides: Partial<SessionSearchHost> = {}): SessionSearchHost {
  const workspace = searchWorkspace(true);
  return {
    getWorkspace: async (id) => (id === workspace.id ? workspace : null),
    getSession: async () => null,
    listWorkspaceSessions: async () => [],
    listAgentSessions: async () => [],
    countSessionMessages: async () => 0,
    searchMessages: async () => [],
    countMessagesBefore: async () => 0,
    countMessagesAfter: async () => 0,
    getLatestMessage: async () => null,
    getMessage: async () => null,
    listMessagesBefore: async () => [],
    listMessagesAfter: async () => [],
    getMessageSummary: async () => null,
    ...overrides,
  };
}

function searchWorkspace(enabled: boolean, risk: 'none' | 'low' = 'none', id = 'ws-search'): Workspace {
  return {
    id,
    name: 'Search workspace',
    path: '/workspace/search',
    isVirtual: false,
    additionalPaths: [],
    settings: {
      autoApproveSeverity: 'low',
      memory: { enabled: false, permissionRisk: 'low' },
      skills: { managementEnabled: false, permissionRisk: 'low' },
      sessionSearch: { enabled, permissionRisk: risk, includeToolResults: false },
      workflow: { enabled: false },
      scheduling: { enabled: false, permissionRisk: 'none' },
    },
    createdAt: '',
    updatedAt: '',
  };
}

function configureEnvironment(): void {
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeConfiguration();
  configureRuntimeHost(minimalHost());
  configurePreconfigSource();
  configureAgentSource();
  configureInstructionSource();
  configureSessionSearchHost();
  configureSchedulerHost(minimalSchedulerHost());
  configureWorkspaceToolDiscovery();
}

beforeEach(() => configureEnvironment());

afterEach(async () => {
  configureEnvironment();
  resetDomainToolFallbacksForTests();
  resetProviders();
  clearCache();
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

const preconfig = {
  id: 'agent',
  name: 'Agent',
  systemPrompt: 'PROMPT',
} as Preconfig;

function buildOptions(workspacePath: string, workspaceId: string) {
  return {
    toolNames: [],
    workspacePath,
    workspaceId,
    sessionId: 'sess-search',
    canSpawnSubagents: false,
    allowedSkills: null,
    // The ask api is created for every execution (pre-C5 behavior), so a
    // channel must exist even when the configured risk never asks.
    broadcastFn: () => {},
  };
}

async function searchWorkspaceDir(label: string): Promise<{ root: string; workspacePath: string }> {
  const root = await tempDir(label);
  const workspacePath = join(root, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  return { root, workspacePath };
}

const foundResult: SearchMessageResult = {
  messageId: 'm-1',
  sessionId: 's-1',
  workspaceId: 'ws-search',
  role: 'user',
  content: 'snippet text',
  timestamp: 42,
  sessionTitle: 'S1',
  rank: 0,
};

const foundShape = {
  success: true,
  mode: 'search',
  title: 'Searched workspace sessions',
  query: 'needle',
  scope: 'workspace',
  results: [{
    sessionId: 's-1',
    sessionTitle: 'S1',
    messageId: 'm-1',
    role: 'user',
    timestamp: 42,
    snippet: 'snippet text',
    rank: 0,
    messagesBefore: 3,
    messagesAfter: 4,
  }],
  _visualization: {
    type: 'file-list',
    badge: '1 result',
    singularLabel: 'result',
    pluralLabel: 'results',
    title: 'needle',
    files: [{ path: 'S1' }],
    total: 1,
  },
};

function searchHostWithFound(): SessionSearchHost {
  return searchHost({
    searchMessages: async () => [foundResult],
    countMessagesBefore: async () => 3,
    countMessagesAfter: async () => 4,
  });
}

describe('C5 session-search composed execution', () => {
  test('the composed tool delegates a search result to the host exactly', async () => {
    const { workspacePath } = await searchWorkspaceDir('delegation');
    const workspace = searchWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureSessionSearchHost(searchHostWithFound());

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
        expect(Object.keys(tools)).toEqual(['session_search', 'retrieve-tool-output']);
        const result = await tools['session_search']!.execute!(
          { query: 'needle', scope: 'workspace' },
          { toolCallId: 'call-search', messages: [] },
        );
        expect(result).toEqual(foundShape);
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('includeToolResults widens the default search role filter unchanged', async () => {
    const { workspacePath } = await searchWorkspaceDir('roles');
    const workspace: Workspace = {
      ...searchWorkspace(true),
      settings: {
        ...searchWorkspace(true).settings,
        sessionSearch: { enabled: true, permissionRisk: 'none', includeToolResults: true },
      },
    };
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));

    let received: Parameters<SessionSearchHost['searchMessages']>[0] | undefined;
    configureSessionSearchHost(searchHost({
      async searchMessages(options) {
        received = options;
        return [];
      },
    }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
        const result = await tools['session_search']!.execute!(
          { query: 'needle' },
          { toolCallId: 'call-roles', messages: [] },
        );
        expect(received?.roleFilter).toEqual(['user', 'assistant', 'tool']);
        expect(result).toEqual({
          success: true,
          mode: 'search',
          title: 'No prior context found',
          query: 'needle',
          scope: 'workspace',
          results: [],
          _visualization: {
            type: 'file-list',
            badge: '0 results',
            singularLabel: 'result',
            pluralLabel: 'results',
            title: 'needle',
            files: [],
            total: 0,
          },
        });
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('permission risk routes through the ask seam with denial and approval unchanged', async () => {
    const { workspacePath } = await searchWorkspaceDir('permission');
    const workspace = searchWorkspace(true, 'low');
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureRuntimeHost(permissionAwareHost());
    configureSessionSearchHost(searchHostWithFound());

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        let pendingRequestId: string | null = null;
        const tools = await buildAiSdkTools({
          ...buildOptions(workspacePath, workspace.id),
          broadcastFn: (message) => {
            if (message.type === 'ask.request' && 'requestId' in message) {
              pendingRequestId = message.requestId ?? null;
            }
          },
        });

        const deniedPromise = tools['session_search']!.execute!(
          { query: 'needle' },
          { toolCallId: 'call-denied', messages: [] },
        );
        await flush();
        expect(pendingRequestId).not.toBeNull();
        resolvePermission(pendingRequestId!, { type: 'permission', grant: 'deny' });
        expect(await deniedPromise).toEqual({ error: 'USER_REJECTION' });

        pendingRequestId = null;
        const approvedPromise = tools['session_search']!.execute!(
          { query: 'needle' },
          { toolCallId: 'call-approved', messages: [] },
        );
        await flush();
        expect(pendingRequestId).not.toBeNull();
        resolvePermission(pendingRequestId!, { type: 'permission', grant: 'once' });
        expect(await approvedPromise).toEqual(foundShape);
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('a missing host workspace returns the structured tool failure unchanged', async () => {
    const { workspacePath } = await searchWorkspaceDir('missing-workspace');
    const workspace = searchWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureSessionSearchHost(searchHost({ getWorkspace: async () => null }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
        expect(tools).toHaveProperty('session_search');
        const result = await tools['session_search']!.execute!(
          { query: 'needle' },
          { toolCallId: 'call-missing-ws', messages: [] },
        );
        expect(result).toEqual({ error: 'Workspace not found' });
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('a throwing host adapter keeps its current rejection behavior through the built tool', async () => {
    const { workspacePath } = await searchWorkspaceDir('throwing-host');
    const workspace = searchWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureSessionSearchHost(searchHost({
      searchMessages() {
        throw new Error('fts index exploded');
      },
    }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
        await expect(
          tools['session_search']!.execute!(
            { query: 'needle' },
            { toolCallId: 'call-throw', messages: [] },
          ),
        ).rejects.toThrow('fts index exploded');
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('disabled settings omit tool and guidance together; enabled settings include both in the same scope', async () => {
    const { workspacePath } = await searchWorkspaceDir('parity');
    const data: ContextAssemblyData = {
      preconfig,
      workspacePath,
      workspaceId: 'ws-search',
      additionalPaths: [],
      selfDelegationAvailable: true,
    };

    const disabledWorkspace = searchWorkspace(false);
    configureStorage(createInMemoryStorageBundle({ workspaces: [disabledWorkspace] }));
    const disabledProcess = await createCurrentProcessScope();
    const disabledAgent = await createCurrentAgentScope(disabledProcess);
    try {
      await enterAgentScope(disabledAgent, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, disabledWorkspace.id));
        expect(tools).not.toHaveProperty('session_search');
        const sections = await disabledAgent.buildContext(data);
        expect(sections.map((section) => section.id)).not.toContain('session-search-guidance');
      });
    } finally {
      await disabledAgent.dispose();
      await disabledProcess.dispose();
    }

    const enabledWorkspace = searchWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [enabledWorkspace] }));
    const enabledProcess = await createCurrentProcessScope();
    const enabledAgent = await createCurrentAgentScope(enabledProcess);
    try {
      await enterAgentScope(enabledAgent, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, enabledWorkspace.id));
        expect(tools).toHaveProperty('session_search');
        const sections = await enabledAgent.buildContext(data);
        expect(sections.map((section) => section.id)).toContain('session-search-guidance');
        expect(sections.at(-1)).toEqual({
          id: 'session-search-guidance',
          phase: 'workspace',
          content: SESSION_SEARCH_GUIDANCE,
        });
      });
    } finally {
      await enabledAgent.dispose();
      await enabledProcess.dispose();
    }
  });

  test('the composed payload uses the scope-captured host and storage, not module globals', async () => {
    const { workspacePath } = await searchWorkspaceDir('captured');
    const workspace = searchWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureSessionSearchHost(searchHostWithFound());

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);

    configureStorage(createInMemoryStorageBundle());
    configureSessionSearchHost(searchHost({
      searchMessages() {
        throw new Error('module global host used');
      },
    }));

    try {
      await enterAgentScope(agentScope, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
        expect(tools).toHaveProperty('session_search');
        const result = await tools['session_search']!.execute!(
          { query: 'needle', scope: 'workspace' },
          { toolCallId: 'call-captured', messages: [] },
        );
        expect(result).toEqual(foundShape);

        const sections = await agentScope.buildContext({
          preconfig,
          workspacePath,
          workspaceId: workspace.id,
          additionalPaths: [],
          selfDelegationAvailable: true,
        });
        expect(sections.map((section) => section.id)).toContain('session-search-guidance');
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('permissionRisk and includeToolResults are captured at build time and not re-read at execution', async () => {
    const { workspacePath } = await searchWorkspaceDir('captured-settings');
    const workspace = searchWorkspace(true, 'low');
    workspace.settings.sessionSearch = { enabled: true, permissionRisk: 'low', includeToolResults: true };
    const base = createInMemoryStorageBundle();
    const storage: StorageBundle = {
      ...base,
      workspaces: {
        get: async (id) => (id === workspace.id ? workspace : null),
        getAutoApproveSeverity: async (workspaceId) =>
          workspaceId === workspace.id ? workspace.settings?.autoApproveSeverity ?? 'low' : 'low',
      },
    };
    configureStorage(storage);
    configureRuntimeHost(permissionAwareHost());
    let received: Parameters<SessionSearchHost['searchMessages']>[0] | undefined;
    configureSessionSearchHost(searchHost({
      async searchMessages(options) {
        received = options;
        return [foundResult];
      },
      countMessagesBefore: async () => 3,
      countMessagesAfter: async () => 4,
    }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        let pendingRequestId: string | null = null;
        const tools = await buildAiSdkTools({
          ...buildOptions(workspacePath, workspace.id),
          broadcastFn: (message) => {
            if (message.type === 'ask.request' && 'requestId' in message) {
              pendingRequestId = message.requestId ?? null;
            }
          },
        });

        // Settings mutation after build must not change the captured risk
        // or role filter.
        workspace.settings.sessionSearch = {
          enabled: true,
          permissionRisk: 'none',
          includeToolResults: false,
        };

        const deniedPromise = tools['session_search']!.execute!(
          { query: 'needle', scope: 'workspace' },
          { toolCallId: 'call-captured-denied', messages: [] },
        );
        await flush();
        expect(pendingRequestId).not.toBeNull();
        resolvePermission(pendingRequestId!, { type: 'permission', grant: 'deny' });
        expect(await deniedPromise).toEqual({ error: 'USER_REJECTION' });

        pendingRequestId = null;
        const approvedPromise = tools['session_search']!.execute!(
          { query: 'needle', scope: 'workspace' },
          { toolCallId: 'call-captured-approved', messages: [] },
        );
        await flush();
        expect(pendingRequestId).not.toBeNull();
        resolvePermission(pendingRequestId!, { type: 'permission', grant: 'once' });
        expect(await approvedPromise).toEqual(foundShape);
        expect(received?.roleFilter).toEqual(['user', 'assistant', 'tool']);
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });
});

describe('C5 session-search domain composition', () => {
  test('the current composition installs the domain plugin with a visible service-derived tool and owned guidance', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const service = agentScope.optional(capekSessionSearchDomainKey);
      expect(service).toBeDefined();

      const contributed = agentScope.listTools().find(
        (tool) => tool.definition.name === 'session_search',
      );
      expect(contributed).toBeDefined();
      expect(contributed?.pluginId).toBe(CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID);
      // Capability visibility only: the runtime settings gate is dynamic
      // per-workspace data and is not encoded in scope diagnostics.
      expect(contributed?.visible).toBe(true);
      expect(contributed?.hiddenReasons).toEqual([]);

      const guidance = agentScope.listContextSections().find(
        (section) => section.id === 'session-search-guidance',
      );
      expect(guidance).toBeDefined();
      expect(guidance?.pluginId).toBe(CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID);
      expect(guidance?.scopeKind).toBe('agent');
      expect(guidance?.phase).toBe('workspace');
      expect(guidance?.order).toBe(50);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the domain service shares one availability predicate between the tool payload and the guidance', async () => {
    const workspace = searchWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const service = agentScope.require(capekSessionSearchDomainKey);
      await expect(service.isEnabled(workspace.id)).resolves.toBe(true);
      await expect(service.isEnabled('ws-missing')).resolves.toBe(false);
      expect(service.tools).toHaveLength(1);
      expect(service.tools[0]!.name).toBe('session_search');
      expect(service.tools[0]!.isEnabled).toBe(service.isEnabled);
      expect(service.guidance).toBe(SESSION_SEARCH_GUIDANCE);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('a composed scope without the domain plugin exposes neither tool nor guidance with a fallback registered', async () => {
    const { workspacePath } = await searchWorkspaceDir('no-domain');
    const workspace = searchWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureSessionSearchHost(searchHostWithFound());
    installSessionSearchToolFallback();

    const withoutDomain = currentAgentPlugins().filter(
      (plugin) => plugin.id !== CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID,
    );
    const processScope = await createCurrentProcessScope();
    const agentScope = await createAgentScope(processScope, [...withoutDomain]);
    try {
      expect(agentScope.optional(capekSessionSearchDomainKey)).toBeUndefined();
      expect(agentScope.listTools().some(
        (tool) => tool.definition.name === 'session_search',
      )).toBe(false);
      expect(agentScope.listContextSections().some(
        (section) => section.id === 'session-search-guidance',
      )).toBe(false);

      await enterAgentScope(agentScope, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
        expect(tools).not.toHaveProperty('session_search');

        const sections = await agentScope.buildContext({
          preconfig,
          workspacePath,
          workspaceId: workspace.id,
          additionalPaths: [],
          selfDelegationAvailable: true,
        });
        expect(sections.map((section) => section.id)).not.toContain('session-search-guidance');
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });
});

describe('unscoped compatibility fallback', () => {
  test('the explicitly installed fallback keeps the unscoped tool behavior', async () => {
    const { workspacePath } = await searchWorkspaceDir('fallback');
    const workspace = searchWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureSessionSearchHost(searchHostWithFound());
    installSessionSearchToolFallback();

    const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
    expect(tools).toHaveProperty('session_search');
    const result = await tools['session_search']!.execute!(
      { query: 'needle', scope: 'workspace' },
      { toolCallId: 'call-fallback', messages: [] },
    );
    expect(result).toEqual(foundShape);
  });

  test('without a registered fallback the unscoped path omits the tool', async () => {
    const { workspacePath } = await searchWorkspaceDir('no-fallback');
    const workspace = searchWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureSessionSearchHost(searchHostWithFound());
    expect(getDomainToolFallback('session_search')).toBeNull();

    const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
    expect(tools).not.toHaveProperty('session_search');
  });

  test('resetDomainToolFallbacksForTests resets the registry', () => {
    installSessionSearchToolFallback();
    expect(getDomainToolFallback('session_search')).not.toBeNull();
    resetDomainToolFallbacksForTests();
    expect(getDomainToolFallback('session_search')).toBeNull();
  });

  test('the unscoped fallback resolves the search host at execution time like pre-C5', async () => {
    const { workspacePath } = await searchWorkspaceDir('fallback-host');
    const workspace = searchWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    installSessionSearchToolFallback();
    // Configured after installation: pre-C5 read the module host at
    // execution time, and the fallback keeps that.
    configureSessionSearchHost(searchHostWithFound());

    const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
    const result = await tools['session_search']!.execute!(
      { query: 'needle', scope: 'workspace' },
      { toolCallId: 'call-fallback-host', messages: [] },
    );
    expect(result).toEqual(foundShape);
  });
});

describe('contributed domain tool payload context', () => {
  test('the three states: unscoped null, composed empty map, composed payload map', async () => {
    expect(getContributedDomainToolPayloads()).toBeNull();

    const workspace = searchWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureSessionSearchHost(searchHostWithFound());
    installSessionSearchToolFallback();

    const withoutDomains = currentAgentPlugins().filter(
      (plugin) => plugin.id !== CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID
        && plugin.id !== CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID
        && plugin.id !== CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID
        && plugin.id !== CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID
        && plugin.id !== CURRENT_MEMORY_DOMAIN_PLUGIN_ID
        && plugin.id !== CURRENT_SKILLS_DOMAIN_PLUGIN_ID,
    );
    const emptyProcess = await createCurrentProcessScope();
    const emptyAgent = await createAgentScope(emptyProcess, [...withoutDomains]);
    const fullProcess = await createCurrentProcessScope();
    const fullAgent = await createCurrentAgentScope(fullProcess);
    try {
      enterAgentScope(emptyAgent, () => {
        const payloads = getContributedDomainToolPayloads();
        expect(payloads).not.toBeNull();
        expect(payloads?.size).toBe(0);
      });

      enterAgentScope(fullAgent, () => {
        const service = fullAgent.require(capekSessionSearchDomainKey);
        const schedulerService = fullAgent.require(capekSchedulerDomainKey);
        const payloads = getContributedDomainToolPayloads();
        expect(payloads?.size).toBe(9);
        expect(payloads?.get('session_search')).toBe(service.tools[0]);
        expect(payloads?.get('scheduler')).toBe(schedulerService.tools[0]);
        expect(payloads?.get('task')).toBeDefined();
        expect(payloads?.get('workflow')).toBeDefined();
        expect(payloads?.get('skill')).toBeDefined();
        expect(payloads?.get('memory')).toBeDefined();
        expect(payloads?.get('skill_manage')).toBeDefined();
        expect(payloads?.get('agent_memory')).toBeDefined();
        expect(payloads?.get('agent_skill_manage')).toBeDefined();
      });

      expect(getContributedDomainToolPayloads()).toBeNull();
    } finally {
      await fullAgent.dispose();
      await fullProcess.dispose();
      await emptyAgent.dispose();
      await emptyProcess.dispose();
    }
  });

  test('a foreign same-name tool without the payload field does not shadow the domain payload', async () => {
    const foreign: CapekPlugin<unknown> = {
      id: 'foreign.session-search-impostor',
      scope: 'agent',
      setup(context: PluginContext) {
        context.contributeTool({
          id: 'foreign.session_search',
          order: 800,
          definition: { name: 'session_search', description: 'foreign impostor' },
        });
      },
    };
    const processScope = await createCurrentProcessScope();
    const agentScope = await createAgentScope(processScope, [
      ...currentAgentPlugins(),
      foreign,
    ]);
    try {
      const service = agentScope.require(capekSessionSearchDomainKey);
      enterAgentScope(agentScope, () => {
        const payloads = getContributedDomainToolPayloads();
        expect(payloads?.get('session_search')).toBe(service.tools[0]);
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('a payload whose name mismatches its contribution is ignored', async () => {
    const mismatched: CapekPlugin<unknown> = {
      id: 'foreign.mismatched-payload',
      scope: 'agent',
      setup(context: PluginContext) {
        context.contributeTool({
          id: 'foreign.mismatched',
          order: 800,
          definition: {
            name: 'session_search',
            description: 'mismatched',
            inputSchema: {},
            [DOMAIN_TOOL_PAYLOAD_FIELD]: {
              name: 'other-tool',
              description: 'not session_search',
              inputSchema: {},
              execute: async () => ({ success: true }),
            },
          },
        });
      },
    };
    const processScope = await createCurrentProcessScope();
    const agentScope = await createAgentScope(processScope, [
      ...currentAgentPlugins(),
      mismatched,
    ]);
    try {
      const service = agentScope.require(capekSessionSearchDomainKey);
      enterAgentScope(agentScope, () => {
        const payloads = getContributedDomainToolPayloads();
        expect(payloads?.get('session_search')).toBe(service.tools[0]);
        expect(payloads?.get('other-tool')).toBeUndefined();
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('nested and interleaved scopes isolate payloads', async () => {
    const withoutDomains = currentAgentPlugins().filter(
      (plugin) => plugin.id !== CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID
        && plugin.id !== CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID
        && plugin.id !== CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID
        && plugin.id !== CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID
        && plugin.id !== CURRENT_MEMORY_DOMAIN_PLUGIN_ID
        && plugin.id !== CURRENT_SKILLS_DOMAIN_PLUGIN_ID,
    );
    const processScope = await createCurrentProcessScope();
    const fullAgent = await createCurrentAgentScope(processScope);
    const emptyAgent = await createAgentScope(processScope, [...withoutDomains]);
    try {
      const service = fullAgent.require(capekSessionSearchDomainKey);
      enterAgentScope(fullAgent, () => {
        expect(getContributedDomainToolPayloads()?.get('session_search')).toBe(service.tools[0]);
        enterAgentScope(emptyAgent, () => {
          expect(getContributedDomainToolPayloads()?.size).toBe(0);
        });
        expect(getContributedDomainToolPayloads()?.get('session_search')).toBe(service.tools[0]);
      });
      expect(getContributedDomainToolPayloads()).toBeNull();
    } finally {
      await emptyAgent.dispose();
      await fullAgent.dispose();
      await processScope.dispose();
    }
  });
});

describe('C5 facade and current context parity', () => {
  test('facade and current composed output stay byte-identical to the fixed builder with search enabled', async () => {
    const root = await tempDir('parity-builder');
    const workspacePath = join(root, 'workspace');
    await mkdir(workspacePath, { recursive: true });
    const workspace: Workspace = {
      ...searchWorkspace(true, 'none', 'ws-parity'),
      path: workspacePath,
    };
    const storage = createInMemoryStorageBundle({ workspaces: [workspace] });
    configureStorage(storage);

    const data: ContextAssemblyData = {
      preconfig,
      workspacePath,
      workspaceId: workspace.id,
      additionalPaths: [],
      selfDelegationAvailable: true,
    };
    const fixed = await buildSystemMessage(data);
    expect(fixed).toContain('You can use session_search');

    const facadeProcess = await createCurrentProcessScope();
    const facade = await createComposition(facadeProcess, {
      storage,
      configuration: createDefaultRuntimeConfiguration(),
      host: minimalHost(),
      contextSources: {},
      workspaceToolDiscovery: {},
      sandboxController: new SandboxController(),
      providerOverrides: new Map(),
    });
    try {
      const facadeOrdered = await enterAgentScope(facade.agentScope, () =>
        getContextAssembler().build(data));
      expect(facadeOrdered).toBe(fixed);
      const facadeGuidance = facade.agentScope.listContextSections().find(
        (section) => section.id === 'session-search-guidance',
      );
      expect(facadeGuidance?.pluginId).toBe('facade.context-sections');
    } finally {
      await facade.agentScope.dispose();
      await facadeProcess.dispose();
    }

    const currentProcess = await createCurrentProcessScope();
    const currentAgent = await createCurrentAgentScope(currentProcess);
    try {
      const currentOrdered = await enterAgentScope(currentAgent, () =>
        getContextAssembler().build(data));
      expect(currentOrdered).toBe(fixed);
      expect(currentAgent.listContextSections().map((section) => section.id)).toEqual([
        ...CURRENT_CONTEXT_SECTION_IDS,
      ]);
      const currentGuidance = currentAgent.listContextSections().find(
        (section) => section.id === 'session-search-guidance',
      );
      expect(currentGuidance?.pluginId).toBe(CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID);
    } finally {
      await currentAgent.dispose();
      await currentProcess.dispose();
    }
  });
});
