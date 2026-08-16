import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import ts from 'typescript';
import {
  buildSystemMessage,
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
  configureRuntimeConfiguration,
  configureSchedulerHost,
  configureSessionSearchHost,
  configureToolSource,
  configureToolsPath,
  createModelForProvider,
  getConnectableProviders,
  getJean2CompatibilityBindings,
  getProvider,
  getRuntimeConfiguration,
  getSchedulerHost,
  getSessionSearchHost,
  getToolSource,
  sandboxController,
} from '@capekai/core/compat/jean2';
import {
  configureStorage,
  createInMemoryStorageBundle,
  getStorage,
} from '@capekai/core/storage';
import {
  capekContextAssemblerKey,
  capekContextSourcesKey,
  capekProviderOverridesKey,
  capekProviderRegistryKey,
  capekRuntimeConfigurationKey,
  capekRuntimeHostKey,
  capekSandboxControllerKey,
  capekSchedulerHostKey,
  capekSessionSearchHostKey,
  capekStorageKey,
  capekToolResolverKey,
  capekToolSourceKey,
  type AgentScopeHandle,
  type ProcessScopeHandle,
} from '@capekai/core/internal/composition';
import * as focused from '@/adapters/capek';
import { configureJean2SessionSearchHost } from '@/adapters/capek/session-search';
import { configureCapekJean2Compatibility, createJean2RuntimeComposition, createRuntime } from '@/bootstrap/create-runtime';
import { createMessage, createPart } from '@/store';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { createTestTextPart, createTestUserMessage } from '#tests/factories';
import { seedSession, seedWorkspace } from '#tests/seed';
import * as legacy from '@/capek-adapter';
import * as legacyEvents from '@/capek-event-adapter';
import * as events from '@/adapters/capek/events';
import { parseImports } from '../../helpers/import-scan';

const repositoryRoot = resolve(import.meta.dir, '../../../../../');
const serverSourceRoot = resolve(repositoryRoot, 'packages/server/src');
const compositionRootPath = resolve(serverSourceRoot, 'bootstrap/create-runtime.ts');

const expectedCompositionSteps = [
  'configureJean2Storage',
  'configureJean2RuntimeConfiguration',
  'configureJean2PreconfigSource',
  'configureJean2AgentSource',
  'configureJean2InstructionSource',
  'configureJean2SessionSearchHost',
  'configureJean2SchedulerHost',
  'configureJean2ToolSource',
  'configureJean2Bindings',
];

function topLevelCallsOf(sourceText: string, functionName: string): string[] {
  const sourceFile = ts.createSourceFile(
    'create-runtime.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const calls: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      for (const statement of node.body?.statements ?? []) {
        if (
          ts.isExpressionStatement(statement)
          && ts.isCallExpression(statement.expression)
          && ts.isIdentifier(statement.expression.expression)
        ) {
          calls.push(statement.expression.expression.text);
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return calls;
}

describe('Čapek composition root', () => {
  afterEach(() => {
    // Restore every resettable Capek package default so the install test does
    // not leak process-global configuration. The compat bindings host has no
    // unconfigured reset; it remains Jean2-configured, which matches the state
    // installed by setupTestDatabase and the production startup path.
    configureStorage(createInMemoryStorageBundle());
    configureRuntimeConfiguration();
    configurePreconfigSource();
    configureAgentSource();
    configureInstructionSource();
    configureSessionSearchHost();
    configureSchedulerHost();
    configureToolsPath();
    configureToolSource();
  });

  test('imports only the pinned adapter, infrastructure, and store wiring set', () => {
    const imports = parseImports(
      readFileSync(compositionRootPath, 'utf8'),
      compositionRootPath,
    );

    expect(imports.length).toBeGreaterThan(0);
    const allowedSpecifiers = [
      '@/adapters/capek',
      '@/adapters/capek/storage',
      '@/adapters/capek/session-search',
      '@/adapters/capek/scheduler',
      '@/adapters/capek/composition',
      '@/adapters/jean2/session-repository',
      '@/adapters/jean2/scheduled-job-execution',
      '@/infrastructure/sqlite/session-search-query-repository',
      '@/infrastructure/sqlite/scheduled-job-repository',
      '@/store',
    ];
    for (const imp of imports) {
      expect(allowedSpecifiers).toContain(imp.specifier);
    }
  });

  test('assembles the adapters in the established legacy order', () => {
    const source = readFileSync(compositionRootPath, 'utf8');
    expect(topLevelCallsOf(source, 'createRuntime')).toEqual(expectedCompositionSteps);
  });

  test('configureCapekJean2Compatibility installs the full adapter set with preserved identities', () => {
    configureCapekJean2Compatibility();

    expect(getJean2CompatibilityBindings()).toBe(legacy.jean2CompatibilityBindings);
    expect(getRuntimeConfiguration()).toBe(legacy.jean2RuntimeConfiguration);
    expect(getStorage()).toBe(legacy.jean2StorageBundle);
    expect(getSessionSearchHost()).toBe(legacy.jean2SessionSearchHost);
    expect(getSchedulerHost()).toBe(legacy.jean2SchedulerHost);
    expect(getToolSource()).toBe(focused.jean2ToolSource);
    expect(createRuntime).toBeDefined();
  });

  test('the legacy adapter path forwards every prior export by identity', () => {
    expect(Object.keys(legacy).sort()).toEqual([
      'configureCapekJean2Compatibility',
      'jean2CompatibilityBindings',
      'jean2RuntimeConfiguration',
      'jean2SchedulerHost',
      'jean2SessionSearchHost',
      'jean2StorageBundle',
    ].sort());

    expect(legacy.jean2CompatibilityBindings).toBe(focused.jean2CompatibilityBindings);
    expect(legacy.jean2RuntimeConfiguration).toBe(focused.jean2RuntimeConfiguration);
    expect(legacy.jean2SchedulerHost).toBe(focused.jean2SchedulerHost);
    expect(legacy.jean2SessionSearchHost).toBe(focused.jean2SessionSearchHost);
    expect(legacy.jean2StorageBundle).toBe(focused.jean2StorageBundle);
  });

  test('the legacy event adapter path forwards every prior export by identity', () => {
    expect(Object.keys(legacyEvents).sort()).toEqual([
      'createJean2RuntimeContext',
      'deliverCapekEvent',
      'mapCapekEventToServerMessage',
    ].sort());

    expect(legacyEvents.mapCapekEventToServerMessage).toBe(events.mapCapekEventToServerMessage);
    expect(legacyEvents.createJean2RuntimeContext).toBe(events.createJean2RuntimeContext);
    expect(legacyEvents.deliverCapekEvent).toBe(events.deliverCapekEvent);
  });
});

describe('S5 session-search host wiring', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  afterEach(() => {
    configureJean2SessionSearchHost();
    configureSessionSearchHost();
    resetTestDatabase();
  });

  test('the installed host delegates search to the infrastructure sqlite repository', () => {
    const host = getSessionSearchHost();
    expect(host).toBe(focused.jean2SessionSearchHost);

    seedWorkspace({ id: 'ws-composed' });
    const session = seedSession('ws-composed');
    createMessage(createTestUserMessage(session.id, { id: 'cm1', createdAt: 100 }));
    createPart(createTestTextPart('cm1', 'composed search'), session.id);

    const results = host.searchMessages({
      query: 'composed',
      roleFilter: ['user', 'assistant'],
      limit: 10,
      sort: 'relevance',
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.messageId).toBe('cm1');
  });
});

describe('C2 kernel composition of Jean2 dependencies', () => {
  let processScope: ProcessScopeHandle | null = null;
  let agentScope: AgentScopeHandle | null = null;

  afterEach(async () => {
    if (agentScope !== null) {
      await agentScope.dispose();
      agentScope = null;
    }
    if (processScope !== null) {
      await processScope.dispose();
      processScope = null;
    }
  });

  test('composes the installed Jean2 objects through process and agent providers by exact identity', async () => {
    configureCapekJean2Compatibility();

    const composition = await createJean2RuntimeComposition();
    processScope = composition.processScope;
    agentScope = composition.agentScope;

    expect(agentScope.require(capekStorageKey)).toBe(legacy.jean2StorageBundle);
    expect(agentScope.require(capekRuntimeConfigurationKey)).toBe(legacy.jean2RuntimeConfiguration);
    expect(agentScope.require(capekRuntimeHostKey)).toBe(legacy.jean2CompatibilityBindings);
    expect(agentScope.require(capekToolSourceKey)).toBe(focused.jean2ToolSource);
    expect(agentScope.require(capekSandboxControllerKey)).toBe(sandboxController);
    expect(agentScope.require(capekProviderOverridesKey)).toBeInstanceOf(Map);
    expect([...agentScope.require(capekProviderOverridesKey)]).toEqual([]);

    const sources = agentScope.require(capekContextSourcesKey);
    expect(sources.preconfigs).toBe(focused.jean2PreconfigSource);
    expect(sources.agents).toBe(focused.jean2AgentSource);
    expect(sources.instructions).toBe(focused.jean2InstructionSource);

    expect(processScope.require(capekSessionSearchHostKey)).toBe(legacy.jean2SessionSearchHost);
    expect(processScope.require(capekSchedulerHostKey)).toBe(legacy.jean2SchedulerHost);
    expect(typeof processScope.require(capekProviderRegistryKey).getProvider).toBe('function');

    // The S1 accessors still return the same objects: the runtime path is
    // unchanged by the composition representation.
    expect(getJean2CompatibilityBindings()).toBe(legacy.jean2CompatibilityBindings);
    expect(getRuntimeConfiguration()).toBe(legacy.jean2RuntimeConfiguration);
    expect(getStorage()).toBe(legacy.jean2StorageBundle);
    expect(getSessionSearchHost()).toBe(legacy.jean2SessionSearchHost);
    expect(getSchedulerHost()).toBe(legacy.jean2SchedulerHost);
    expect(getToolSource()).toBe(focused.jean2ToolSource);
  });

  test('diagnostics list every Jean2 seam with correct key scopes and provider ownership', async () => {
    configureCapekJean2Compatibility();

    const composition = await createJean2RuntimeComposition();
    processScope = composition.processScope;
    agentScope = composition.agentScope;

    const agentServices = agentScope.snapshot().services.map((service) => [
      service.keyId,
      service.keyScope,
      service.providerPluginId,
      service.providerScope,
    ]);

    expect(agentServices).toEqual([
      ['capek.editing-capability', 'agent', 'coding.editing', 'agent'],
      ['capek.filesystem-capability', 'agent', 'coding.filesystem', 'agent'],
      ['capek.question-capability', 'agent', 'coding.question', 'agent'],
      ['capek.search-capability', 'agent', 'coding.search', 'agent'],
      ['capek.shell-capability', 'agent', 'coding.shell', 'agent'],
      ['capek.tool-output-capability', 'agent', 'coding.tool-output', 'agent'],
      ['capek.context-assembler', 'agent', 'current.context-sections', 'agent'],
      ['capek.context-sources', 'agent', 'current.context-sources', 'agent'],
      ['capek.orchestrator-session', 'agent', 'current.orchestrator-session', 'agent'],
      ['capek.provider-overrides', 'agent', 'current.provider-overrides', 'agent'],
      ['capek.runtime-configuration', 'agent', 'current.runtime-configuration', 'agent'],
      ['capek.runtime-host', 'agent', 'current.runtime-host', 'agent'],
      ['capek.sandbox-controller', 'agent', 'current.sandbox-controller', 'agent'],
      ['capek.storage', 'agent', 'current.storage', 'agent'],
      ['capek.goal-domain', 'agent', 'current.goal-domain', 'agent'],
      ['capek.memory-domain', 'agent', 'current.memory-domain', 'agent'],
      ['capek.scheduler-domain', 'agent', 'current.scheduler-domain', 'agent'],
      ['capek.session-search-domain', 'agent', 'current.session-search-domain', 'agent'],
      ['capek.skills-domain', 'agent', 'current.skills-domain', 'agent'],
      ['capek.subagent-domain', 'agent', 'current.subagent-domain', 'agent'],
      ['capek.tool-source', 'agent', 'current.tool-source', 'agent'],
      ['capek.workflow-domain', 'agent', 'current.workflow-domain', 'agent'],
      ['capek.installed-tool-registry', 'process', 'current.installed-tool-registry', 'process'],
      ['capek.provider-registry', 'process', 'current.provider-registry', 'process'],
      ['capek.scheduler-host', 'process', 'current.scheduler-host', 'process'],
      ['capek.session-search-host', 'process', 'current.session-search-host', 'process'],
    ]);

    // The current agent composition intentionally omits the optional tool
    // resolver so installed-tool cache resolution runs unchanged.
    expect(agentScope.optional(capekToolResolverKey)).toBeUndefined();
    expect(agentServices.some((entry) => entry[0] === 'capek.tool-resolver')).toBe(false);

    // Diagnostics expose metadata only: no service values, functions, or
    // credential-bearing strings survive serialization.
    const serialized = JSON.stringify(agentScope.snapshot());
    expect(serialized).not.toContain('getApiKey');
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('"function"');
  });

  test('provider plugin methods are the current registry functions', async () => {
    configureCapekJean2Compatibility();

    const composition = await createJean2RuntimeComposition();
    processScope = composition.processScope;
    agentScope = composition.agentScope;

    const registry = processScope.require(capekProviderRegistryKey);
    expect(registry.getProvider).toBe(getProvider);
    expect(registry.getConnectableProviders).toBe(getConnectableProviders);
    expect(registry.createModelForProvider).toBe(createModelForProvider);
  });
});

describe('C4 coding bundle in the Jean2 composition', () => {
  let processScope: ProcessScopeHandle | null = null;
  let agentScope: AgentScopeHandle | null = null;

  const STANDARD_CODING_TOOL_NAMES = [
    'read-file',
    'write-file',
    'edit',
    'edit-range',
    'apply-patch',
    'ls',
    'glob',
    'grep',
    'shell',
    'question',
    'retrieve-tool-output',
  ];

  afterEach(async () => {
    if (agentScope !== null) {
      await agentScope.dispose();
      agentScope = null;
    }
    if (processScope !== null) {
      await processScope.dispose();
      processScope = null;
    }
  });

  test('exposes the exact standard contributed coding inventory without a scoped resolver', async () => {
    configureCapekJean2Compatibility();

    const composition = await createJean2RuntimeComposition();
    processScope = composition.processScope;
    agentScope = composition.agentScope;

    const tools = agentScope.listTools();
    expect(tools.map((tool) => tool.definition.name)).toEqual([
      ...STANDARD_CODING_TOOL_NAMES,
      'task',
      'skill',
      'memory',
      'workflow',
      'skill_manage',
      'session_search',
      'scheduler',
      'agent_memory',
      'agent_skill_manage',
    ]);
    for (const tool of tools) {
      expect(tool.visible).toBe(true);
      expect(
        tool.pluginId.startsWith('coding.')
        || tool.pluginId === 'current.session-search-domain'
        || tool.pluginId === 'current.scheduler-domain'
        || tool.pluginId === 'current.subagent-domain'
        || tool.pluginId === 'current.workflow-domain'
        || tool.pluginId === 'current.memory-domain'
        || tool.pluginId === 'current.skills-domain',
      ).toBe(true);
    }

    // The Jean2 representation keeps the installed-tool registry fallback:
    // no scoped tool resolver replaces installed external tool resolution.
    expect(agentScope.optional(capekToolResolverKey)).toBeUndefined();
  });
});

describe('C3 ordered context in the Jean2 composition', () => {
  let processScope: ProcessScopeHandle | null = null;
  let agentScope: AgentScopeHandle | null = null;

  afterEach(async () => {
    if (agentScope !== null) {
      await agentScope.dispose();
      agentScope = null;
    }
    if (processScope !== null) {
      await processScope.dispose();
      processScope = null;
    }
  });

  const contextData = {
    preconfig: {
      id: 'c3-server-agent',
      name: 'C3 server agent',
      description: 'Test preconfig',
      systemPrompt: 'SERVER-PROMPT',
      tools: null,
      model: null,
      provider: null,
      settings: null,
      isDefault: false,
    },
    workspacePath: '/tmp/capek-c3-workspace',
    workspaceId: 'c3-workspace',
    selfDelegationAvailable: true,
  };

  test('buildContext reproduces the fixed builder byte-for-byte through the composed scope', async () => {
    configureCapekJean2Compatibility();
    configureStorage(createInMemoryStorageBundle({
      workspaces: [{
        id: 'c3-workspace',
        name: 'C3 workspace',
        path: '/tmp/capek-c3-workspace',
        isVirtual: false,
        additionalPaths: [],
        settings: {
          autoApproveSeverity: 'low',
          memory: { enabled: true, permissionRisk: 'low' },
          skills: { managementEnabled: true, permissionRisk: 'low' },
          sessionSearch: { enabled: true, permissionRisk: 'low', includeToolResults: false },
        },
        createdAt: '',
        updatedAt: '',
      }],
    }));

    const composition = await createJean2RuntimeComposition();
    processScope = composition.processScope;
    agentScope = composition.agentScope;

    const fixed = await buildSystemMessage(contextData);
    const ordered = await composition.buildContext(contextData);
    expect(ordered).toBe(fixed);
    expect(ordered).toContain('SERVER-PROMPT');
    expect(ordered).toContain('SELF-DELEGATION:');
    expect(ordered).toContain('You can persist durable workspace knowledge');
    expect(ordered).toContain('You can create and update workspace skills');
    expect(ordered).toContain('You can use session_search');
  });

  test('diagnostics list the exact ordered sections with the assembler service pinned', async () => {
    configureCapekJean2Compatibility();

    const composition = await createJean2RuntimeComposition();
    processScope = composition.processScope;
    agentScope = composition.agentScope;

    expect(agentScope.require(capekContextAssemblerKey).id).toBe('current.context-sections');
    expect(agentScope.listContextSections().map((section) => [section.id, section.phase, section.order])).toEqual([
      ['agent-memory', 'identity', 10],
      ['agent-user-preferences', 'identity', 20],
      ['system-prompt', 'identity', 30],
      ['memory-skills-guidance', 'identity', 40],
      ['self-delegation', 'identity', 50],
      ['instructions', 'instructions', 10],
      ['workspace', 'workspace', 10],
      ['workspace-memory', 'workspace', 20],
      ['memory-guidance', 'workspace', 30],
      ['skill-management-guidance', 'workspace', 40],
      ['session-search-guidance', 'workspace', 50],
    ]);

    const serialized = JSON.stringify(agentScope.snapshot());
    expect(serialized).toContain('agent-memory');
    expect(serialized).not.toContain('SERVER-PROMPT');
    expect(serialized).not.toContain('"function"');
  });
});
