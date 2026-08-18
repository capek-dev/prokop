/**
 * C4 review-repair tests.
 *
 * Pins the three independent-review repairs: the contributed tool resolver
 * uses optional capability dependencies so minimal and partial facade
 * compositions activate; buildAiSdkTools keeps the unconditional
 * retrieve-tool-output injection only on the unscoped legacy path while
 * scoped catalogs resolve retrieval through the normal contributed path;
 * and the current Jean2 composition representation installs the coding
 * capability plugins and exposes the exact standard contributed inventory
 * without a scoped tool resolver.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { createDefaultRuntimeConfiguration } from '../src/configuration/defaults';
import { codingAgentBundle } from '../src/bundles/coding-agent';
import { minimalAgentBundle } from '../src/bundles/minimal-agent';
import { buildAiSdkTools } from '../src/core/build-tools';
import type { CapekPlugin } from '../src/kernel/types';
import type { FacadeProfile } from '../src/profiles/facade';
import {
  capekFilesystemCapabilityKey,
  capekQuestionCapabilityKey,
  codingCapabilityPlugin,
  STANDARD_CODING_CAPABILITIES,
} from '../src/plugins/coding-capabilities';
import {
  createCurrentAgentScope,
  createCurrentProcessScope,
  createFacadeAgentComposition,
  enterAgentScope,
  resetSharedProcessScopeForTests,
} from '../src/plugins/compose';
import { capekToolResolverKey } from '../src/plugins/service-keys';
import { CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID } from '../src/plugins/scheduler-domain';
import { CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID } from '../src/plugins/session-search-domain';
import { CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID } from '../src/plugins/subagent-domain';
import { CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID } from '../src/plugins/workflow-domain';
import { CURRENT_MEMORY_DOMAIN_PLUGIN_ID } from '../src/plugins/memory-domain';
import { CURRENT_SKILLS_DOMAIN_PLUGIN_ID } from '../src/plugins/skills-domain';
import { configureRuntimeHost, type RuntimeHost } from '../src/runtime/host';
import { SandboxController } from '../src/sandbox/controller';
import { createInMemoryStorageBundle } from '../src/storage/memory';
import { createToolOutputArtifact, withStorage } from '../src/storage/runtime';
import { STANDARD_TOOL_NAMES } from '../src/tools/standard-tools';

function minimalHost(): RuntimeHost {
  return {
    interaction: {
      createPendingAsk: () => 'pending',
      removePendingAsk: () => {},
      removePendingAsksByToolCallId: () => {},
      getPermissionRequestByRequestId: () => null,
      resolvePermissionRequestByRequestId: () => false,
      expirePermissionRequest: () => false,
      expireOldPermissionRequests: () => 0,
      cancelPendingRequestsBySession: () => 0,
      listPendingAsksBySession: () => [],
      listPendingAsksByRootSession: () => [],
      listPendingRequestsByRootSession: () => [],
      matchGrant: () => ({ matched: false, grant: null }),
      createGrantFromOptions: () => null,
      getSessionAutoApproveSeverity: () => undefined,
      getPermissionTimeoutMs: () => 30 * 60 * 1000,
      notifyPermissionRequired: () => {},
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
        tempDir: '/tmp/capek-c4-repair-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

function facadeComposition(codingPlugins: readonly CapekPlugin<unknown>[]) {
  const profile: FacadeProfile = {
    id: codingPlugins.length === 0 ? 'minimal' : 'coding',
    plugins: () => codingPlugins,
  };
  return createFacadeAgentComposition({
    storage: createInMemoryStorageBundle(),
    configuration: createDefaultRuntimeConfiguration(),
    host: minimalHost(),
    contextSources: {},
    toolSource: {},
    sandboxController: new SandboxController(),
    providerOverrides: new Map(),
  }, profile);
}

type LooseToolExecute = (
  args: Record<string, unknown>,
  options: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

afterEach(async () => {
  await resetSharedProcessScopeForTests();
});

describe('contributed tool resolver with optional capability dependencies', () => {
  test('a minimal facade composition activates and derives an empty resolver', async () => {
    const { agentScope } = await facadeComposition(minimalAgentBundle());

    expect(agentScope.snapshot().status).toBe('active');
    expect(agentScope.listTools()).toEqual([]);
    const resolver = agentScope.require(capekToolResolverKey);
    expect(resolver.list()).toEqual([]);
    expect(resolver.get('read-file')).toBeNull();

    await agentScope.dispose();
  });

  test('a partial facade composition activates and derives only the installed tools', async () => {
    const { agentScope } = await facadeComposition([
      codingCapabilityPlugin(
        'coding.filesystem',
        capekFilesystemCapabilityKey,
        STANDARD_CODING_CAPABILITIES.filesystem,
      ),
      codingCapabilityPlugin(
        'coding.question',
        capekQuestionCapabilityKey,
        STANDARD_CODING_CAPABILITIES.question,
      ),
    ]);

    expect(agentScope.snapshot().status).toBe('active');
    expect(agentScope.listTools().map((tool) => tool.definition.name as string)).toEqual([
      'read-file',
      'write-file',
      'question',
    ]);
    const resolver = agentScope.require(capekToolResolverKey);
    expect(resolver.list().map((entry) => entry.definition.name)).toEqual([
      'read-file',
      'write-file',
      'question',
    ]);
    expect(resolver.get('shell')).toBeNull();

    await agentScope.dispose();
  });
});

describe('retrieve-tool-output assembly branches', () => {
  test('the unscoped legacy path still injects retrieve-tool-output unconditionally', async () => {
    const storage = createInMemoryStorageBundle();
    await withStorage(storage, async () => {
      const tools = await buildAiSdkTools({
        toolNames: [],
        workspacePath: undefined,
        workspaceId: undefined,
        sessionId: 'legacy-unscoped-session',
      });
      expect(Object.keys(tools)).toEqual(['retrieve-tool-output']);
    });
  });

  test('a scoped minimal profile assembles no tools, including no retrieval', async () => {
    const { agentScope } = await facadeComposition(minimalAgentBundle());

    await enterAgentScope(agentScope, async () => {
      expect(agentScope.require(capekToolResolverKey).list()).toEqual([]);
      const tools = await buildAiSdkTools({
        toolNames: [],
        workspacePath: undefined,
        workspaceId: undefined,
        sessionId: 'scoped-minimal-session',
      });
      expect(Object.keys(tools)).toEqual([]);
    });

    await agentScope.dispose();
  });

  test('a scoped full coding catalog includes retrieval exactly once with session-scoped pages', async () => {
    const { agentScope } = await facadeComposition(codingAgentBundle());

    await enterAgentScope(agentScope, async () => {
      const resolver = agentScope.require(capekToolResolverKey);
      const toolNames = resolver.list().map((entry) => entry.definition.name);
      expect(toolNames).toEqual([...STANDARD_TOOL_NAMES]);

      const artifact = createToolOutputArtifact({
        sessionId: 'scoped-catalog-session',
        toolCallId: 'call-1',
        toolName: 'read-file',
        content: 'x'.repeat(2000),
        format: 'text',
      });
      const foreign = createToolOutputArtifact({
        sessionId: 'foreign-session',
        toolCallId: 'call-9',
        toolName: 'read-file',
        content: 'y'.repeat(2000),
        format: 'text',
      });

      const tools = await buildAiSdkTools({
        toolNames,
        workspacePath: undefined,
        workspaceId: undefined,
        sessionId: 'scoped-catalog-session',
      });
      expect(Object.keys(tools)).toHaveLength(STANDARD_TOOL_NAMES.length);
      expect(Object.keys(tools).filter((name) => name === 'retrieve-tool-output')).toHaveLength(1);

      const execute = (tools['retrieve-tool-output'] as unknown as { execute: LooseToolExecute }).execute;

      const page = await execute(
        { artifactId: artifact.id, offset: 0, limit: 10 },
        { toolCallId: 'call-2' },
      );
      expect((page as { content: string }).content).toBe('x'.repeat(10));

      const missing = await execute({ artifactId: foreign.id }, { toolCallId: 'call-3' });
      expect(missing.error).toBe('Tool output artifact not found');
    });

    await agentScope.dispose();
  });
});

describe('current Jean2 composition representation', () => {
  test('installs the coding capability plugins plus the C5 domain plugins with the exact contributed inventory', async () => {
    configureRuntimeHost(minimalHost());
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);

    const tools = agentScope.listTools();
    expect(tools.map((tool) => tool.definition.name as string)).toEqual([
      ...STANDARD_TOOL_NAMES,
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
      expect(tool.hiddenReasons).toEqual([]);
      expect(
        tool.pluginId.startsWith('coding.')
        || tool.pluginId === CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID
        || tool.pluginId === CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID
        || tool.pluginId === CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID
        || tool.pluginId === CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID
        || tool.pluginId === CURRENT_MEMORY_DOMAIN_PLUGIN_ID
        || tool.pluginId === CURRENT_SKILLS_DOMAIN_PLUGIN_ID,
      ).toBe(true);
    }
    expect(agentScope.optional(capekToolResolverKey)).toBeUndefined();

    await agentScope.dispose();
    await processScope.dispose();
  });
});
