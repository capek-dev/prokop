/**
 * C2 provider inventory, ownership, scope diagnostics, and synchronous
 * scope-entry tests. Maps to the C2 exit gate: every current configurable
 * seam is represented in composition diagnostics with the ownership and
 * scope recorded in .architecture-v2/10-current-inventory.md.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { jsonSchema, type Tool } from 'ai';
import { createDefaultRuntimeConfiguration } from '../src/configuration/defaults';
import { configureRuntimeConfiguration } from '../src/configuration/runtime';
import {
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
} from '../src/context/sources';
import { ScopeValidationError } from '../src/kernel/errors';
import {
  createAgentScope,
  createProcessScope,
} from '../src/kernel/kernel';
import type { CapekPlugin, PluginContext } from '../src/kernel/types';
import {
  createComposition,
  enterAgentScope,
} from '../src/plugins/compose';
import {
  createCurrentAgentScope,
  createCurrentProcessScope,
  CURRENT_AGENT_PLUGIN_IDS,
  CURRENT_PROCESS_PLUGIN_IDS,
  currentAgentPlugins,
  currentProcessPlugins,
} from './helpers/composition';
import { FACADE_AGENT_PLUGIN_IDS } from '../src/plugins/facade-plugins';
import {
  C2_PROCESS_KEYS,
  C2_REQUIRED_AGENT_KEYS,
  C2_SERVICE_KEYS,
  capekContextSourcesKey,
  capekInstalledToolRegistryKey,
  capekProviderOverridesKey,
  capekProviderRegistryKey,
  capekContextAssemblerKey,
  capekRuntimeConfigurationKey,
  capekRuntimeHostKey,
  capekSandboxControllerKey,
  capekSchedulerHostKey,
  capekSessionSearchHostKey,
  capekStorageKey,
  capekToolResolverKey,
  capekWorkspaceToolDiscoveryKey,
} from '../src/plugins/service-keys';
import { resetProviders } from '../src/providers/registry';
import type { RuntimeHost } from '../src/runtime/host';
import { configureRuntimeHost } from '../src/runtime/host';
import { SandboxController } from '../src/sandbox/controller';
import { configureSchedulerHost } from '../src/scheduler/host';
import type { SchedulerHost } from '../src/scheduler/host';
import { configureSessionSearchHost } from '../src/session-search/host';
import type { SessionSearchHost } from '../src/session-search/host';
import { createInMemoryStorageBundle } from '../src/storage/memory';
import { configureStorage, getStorage } from '../src/storage/runtime';
import { getTool } from '../src/tools/registry';
import { configureWorkspaceToolDiscovery } from '../src/tools/tool-source';

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
        tempDir: '/tmp/capek-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

function minimalSearchHost(): SessionSearchHost {
  return {
    getWorkspace: async () => null,
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

afterEach(() => {
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeConfiguration();
  configureRuntimeHost(minimalHost());
  configurePreconfigSource();
  configureAgentSource();
  configureInstructionSource();
  configureSessionSearchHost(minimalSearchHost());
  configureSchedulerHost(minimalSchedulerHost());
  configureWorkspaceToolDiscovery();
  resetProviders();
});

describe('C2 provider inventory', () => {
  test('process plugins cover the four process seams with deterministic ids and no dependencies', () => {
    const plugins = currentProcessPlugins();

    expect(plugins.map((plugin) => plugin.id)).toEqual([...CURRENT_PROCESS_PLUGIN_IDS]);
    for (const plugin of plugins) {
      expect(plugin.scope).toBe('process');
      expect(plugin.provides).toHaveLength(1);
      expect(C2_PROCESS_KEYS.some((key) => plugin.provides?.includes(key))).toBe(true);
      expect(plugin.requires ?? []).toEqual([]);
      expect(plugin.optional ?? []).toEqual([]);
      expect(plugin.overrides ?? []).toEqual([]);
    }
  });

  test('agent plugins cover the required agent seams and intentionally omit the optional resolver', () => {
    const plugins = currentAgentPlugins();

    expect(plugins.map((plugin) => plugin.id)).toEqual([...CURRENT_AGENT_PLUGIN_IDS]);
    const providedIds = new Set(plugins.flatMap((plugin) => plugin.provides ?? []).map((key) => key.id));
    for (const key of C2_REQUIRED_AGENT_KEYS) {
      expect(providedIds.has(key.id)).toBe(true);
    }
    expect(providedIds.has(capekToolResolverKey.id)).toBe(false);
    for (const plugin of plugins) {
      expect(plugin.scope).toBe('agent');
    }
  });

  test('every C2 service key has a distinct id and a valid scope', () => {
    const ids = C2_SERVICE_KEYS.map((key) => key.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const key of C2_SERVICE_KEYS) {
      expect(['process', 'agent', 'run']).toContain(key.scope);
      expect(key.scope).not.toBe('run');
    }
  });

  test('composed scopes resolve every required service to the exact configured objects', async () => {
    const storage = createInMemoryStorageBundle();
    const configuration = {
      ...createDefaultRuntimeConfiguration(),
      getLLMTemperature: () => 0.25,
    };
    const host = minimalHost();
    const search = minimalSearchHost();
    const scheduler = minimalSchedulerHost();
    configureStorage(storage);
    configureRuntimeConfiguration(configuration);
    configureRuntimeHost(host);
    configureSessionSearchHost(search);
    configureSchedulerHost(scheduler);

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);

    expect(agentScope.require(capekStorageKey)).toBe(storage);
    expect(agentScope.require(capekRuntimeConfigurationKey)).toBe(configuration);
    expect(agentScope.require(capekRuntimeHostKey)).toBe(host);
    expect(agentScope.require(capekWorkspaceToolDiscoveryKey)).toBeDefined();
    expect(agentScope.require(capekSandboxControllerKey)).toBeInstanceOf(SandboxController);
    expect(agentScope.require(capekProviderOverridesKey)).toBeInstanceOf(Map);
    expect(typeof agentScope.require(capekContextAssemblerKey).build).toBe('function');
    expect(agentScope.optional(capekToolResolverKey)).toBeUndefined();
    const sources = agentScope.require(capekContextSourcesKey);
    expect(sources.preconfigs).toBeDefined();
    expect(sources.agents).toBeDefined();
    expect(sources.instructions).toBeDefined();

    expect(processScope.require(capekSessionSearchHostKey)).toBe(search);
    expect(processScope.require(capekSchedulerHostKey)).toBe(scheduler);
    const registry = processScope.require(capekProviderRegistryKey);
    expect(typeof registry.getProvider).toBe('function');
    expect(typeof registry.createModelForProvider).toBe('function');
    const installed = processScope.require(capekInstalledToolRegistryKey);
    expect(typeof installed.getTool).toBe('function');
    expect(typeof installed.listTools).toBe('function');

    await agentScope.dispose();
    await processScope.dispose();
  });

  test('composition binds at creation: a scope created before reconfiguration keeps the old object', async () => {
    const first = createInMemoryStorageBundle();
    const second = createInMemoryStorageBundle();
    configureStorage(first);
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);

    configureStorage(second);
    const secondProcess = await createCurrentProcessScope();
    const secondAgent = await createCurrentAgentScope(secondProcess);

    expect(agentScope.require(capekStorageKey)).toBe(first);
    expect(secondAgent.require(capekStorageKey)).toBe(second);

    await agentScope.dispose();
    await processScope.dispose();
    await secondAgent.dispose();
    await secondProcess.dispose();
  });

  test('an agent plugin cannot provide a process-scoped key', async () => {
    const processScope = await createCurrentProcessScope();
    const intruder: CapekPlugin<unknown> = {
      id: 'intruder.agent-provider',
      scope: 'agent',
      provides: [capekProviderRegistryKey],
      setup(context: PluginContext) {
        context.provide(capekProviderRegistryKey, {} as never);
      },
    };

    await expect(createAgentScope(processScope, [intruder])).rejects.toBeInstanceOf(ScopeValidationError);
    await processScope.dispose();
  });

  test('a plugin cannot provide a service without declaring it', async () => {
    const processScope = await createCurrentProcessScope();
    const undeclared: CapekPlugin<unknown> = {
      id: 'intruder.undeclared',
      scope: 'agent',
      provides: [capekStorageKey],
      setup(context: PluginContext) {
        context.provide(capekStorageKey, createInMemoryStorageBundle());
        context.provide(capekProviderOverridesKey, new Map());
      },
    };

    await expect(createAgentScope(processScope, [undeclared])).rejects.toThrow('without declaring it in provides');
    await processScope.dispose();
  });

  test('diagnostics expose metadata only, never service values or callbacks', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);

    const snapshot = agentScope.snapshot();
    expect(snapshot.kind).toBe('agent');
    expect(snapshot.parentKind).toBe('process');
    // Kernel activation is topologically sorted by plugin id; the C5 domain
    // plugins declare the storage service dependency, so they activate right
    // after storage instead of their alphabetical position.
    const sortedIds = [...CURRENT_AGENT_PLUGIN_IDS].sort();
    const domainIds: string[] = [
      'current.goal-domain',
      'current.memory-domain',
      'current.scheduler-domain',
      'current.session-search-domain',
      'current.skills-domain',
      'current.subagent-domain',
      'current.workflow-domain',
    ];
    const expectedPluginIds: string[] = sortedIds.filter((id) => !domainIds.includes(id) && id !== 'current.compaction-policy' && id !== 'current.permission-policy');
    expectedPluginIds.splice(expectedPluginIds.indexOf('current.storage') + 1, 0, ...[
      'current.goal-domain',
      'current.memory-domain',
      'current.scheduler-domain',
      'current.session-search-domain',
      'current.skills-domain',
      'current.subagent-domain',
    ]);
    // The workflow domain requires the subagent domain service and the
    // orchestrator-session contract, so its deterministic activation order
    // lands after tool-output-policy, before the workspace plugins.
    expectedPluginIds.splice(
      expectedPluginIds.indexOf('current.tool-output-policy') + 1,
      0,
      'current.workflow-domain',
    );
    // The C6 compaction provider requires the runtime configuration service
    // (env translation at composition), so it activates right after it
    // instead of its alphabetical position.
    expectedPluginIds.splice(
      expectedPluginIds.indexOf('current.runtime-configuration') + 1,
      0,
      'current.compaction-policy',
    );
    // The C6 permission policy requires the runtime host (permission timeout
    // translation at composition), so it activates right after it instead of
    // its alphabetical position.
    expectedPluginIds.splice(
      expectedPluginIds.indexOf('current.runtime-host') + 1,
      0,
      'current.permission-policy',
    );
    expect(snapshot.plugins.map((plugin) => plugin.id)).toEqual(expectedPluginIds);
    // 4 process services + 10 current agent services (storage, runtime
    // configuration, runtime host, agent driver, context sources, context
    // sections, orchestrator session, tool source, sandbox controller,
    // provider overrides) + the C6 agent-scoped retry policy, compaction service,
    // permission policy and permission runtime, workspace policy, and
    // tool-output policy + the seven C5 domain services (goal, memory,
    // session-search, scheduler, skills, subagent, workflow) installed by
    // the current composition.
    expect(snapshot.services).toHaveLength(27);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('getApiKey');
    expect(serialized).not.toContain('createPendingAsk');
    expect(serialized).not.toContain('"function"');

    await agentScope.dispose();
    await processScope.dispose();
  });
});

describe('C2 agent scope entry', () => {
  test('enterAgentScope seeds every accessor synchronously from composed values before async work', async () => {
    const storage = createInMemoryStorageBundle();
    const configuration = {
      ...createDefaultRuntimeConfiguration(),
      getLLMTemperature: () => 0.75,
    };
    const host = minimalHost();
    const controller = new SandboxController();
    const toolSource = {
      async initializeWorkspace(): Promise<void> {},
      async discoverTools(): Promise<Record<string, Tool>> {
        return {
          'source-tool': {
            description: 'source',
            inputSchema: jsonSchema({ type: 'object', properties: {} }),
          },
        };
      },
    };

    const { agentScope, processScope } = await createComposition(
      await createCurrentProcessScope(),
      {
        storage,
        configuration,
        host,
        contextSources: {},
        workspaceToolDiscovery: toolSource,
        toolResolver: { get: () => null, list: () => [] },
        sandboxController: controller,
        providerOverrides: new Map(),
      });

    let observedSyncSeeding = false;
    await enterAgentScope(agentScope, async () => {
      // All of these run synchronously inside the seeded scope before the
      // first await; getStorage/getRuntimeConfiguration/getRuntimeHost read
      // the AsyncLocalStorage stores directly.
      expect(getStorage()).toBe(storage);
      expect(configuration.getLLMTemperature()).toBe(0.75);
      expect(getTool('read-file')).toBeInstanceOf(Promise);
      observedSyncSeeding = true;
      return Promise.resolve();
    });
    expect(observedSyncSeeding).toBe(true);

    await agentScope.dispose();
    await processScope.dispose();
  });

  test('entering a composition resolves contributed tools through the seeded resolver', async () => {
    const storage = createInMemoryStorageBundle();
    const { agentScope, processScope } = await createComposition(
      await createCurrentProcessScope(),
      {
        storage,
        configuration: createDefaultRuntimeConfiguration(),
        host: minimalHost(),
        contextSources: {},
        workspaceToolDiscovery: {},
        sandboxController: new SandboxController(),
        providerOverrides: new Map(),
      });

    const resolved = await enterAgentScope(agentScope, async () => {
      const retrieval = await getTool('retrieve-tool-output');
      return retrieval?.definition.name ?? null;
    });
    expect(resolved).toBe('retrieve-tool-output');

    await agentScope.dispose();
    await processScope.dispose();
  });

  test('facade plugin ids are deterministic and cover the agent seams plus the resolver', async () => {
    const { agentScope, processScope } = await createComposition(
      await createCurrentProcessScope(),
      {
        storage: createInMemoryStorageBundle(),
        configuration: createDefaultRuntimeConfiguration(),
        host: minimalHost(),
        contextSources: {},
        workspaceToolDiscovery: {},
        toolResolver: { get: () => null, list: () => [] },
        sandboxController: new SandboxController(),
        providerOverrides: new Map(),
      });

    const facadePlugins = agentScope.snapshot().plugins
      .filter((plugin) => plugin.id.startsWith('facade.'))
      .map((plugin) => plugin.id);
    // The C6 compaction provider requires the runtime configuration service
    // (env translation at composition), so activation lands after it instead
    // of the alphabetical position. The permission policy requires the
    // runtime host for the same reason.
    const expectedFacadeIds: string[] = [...FACADE_AGENT_PLUGIN_IDS]
      .filter((id) => id !== 'facade.compaction-policy' && id !== 'facade.permission-policy')
      .sort();
    expectedFacadeIds.splice(
      expectedFacadeIds.indexOf('facade.runtime-configuration') + 1,
      0,
      'facade.compaction-policy',
    );
    expectedFacadeIds.splice(
      expectedFacadeIds.indexOf('facade.runtime-host') + 1,
      0,
      'facade.permission-policy',
    );
    expect(facadePlugins).toEqual(expectedFacadeIds);

    await agentScope.dispose();
    await processScope.dispose();
  });

  test('missing required service composition fails rather than seeding partial state', async () => {
    const partial: CapekPlugin<unknown> = {
      id: 'partial.storage-only',
      scope: 'agent',
      provides: [capekStorageKey],
      setup(context: PluginContext) {
        context.provide(capekStorageKey, createInMemoryStorageBundle());
      },
    };
    const processScope = await createProcessScope([]);
    const agentScope = await createAgentScope(processScope, [partial]);

    expect(() => enterAgentScope(agentScope, () => getStorage())).toThrow(/not available/);

    await agentScope.dispose();
    await processScope.dispose();
  });
});
