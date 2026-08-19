/**
 * C4 review-repair tests.
 *
 * Pins the three independent-review repairs: the contributed tool resolver
 * activates with or without payload-carrying contributions; buildAiSdkTools
 * keeps the unconditional retrieve-tool-output injection only on the
 * unscoped legacy path while scoped catalogs resolve retrieval through the
 * normal contributed path; and the current Jean2 composition representation
 * exposes the exact C5 domain contributed inventory without a scoped tool
 * resolver.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDefaultRuntimeConfiguration } from '../src/configuration/defaults';
import { buildAiSdkTools } from '../src/core/build-tools';
import type { CapekPlugin, ToolDefinition as KernelToolDefinition } from '../src/kernel/types';
import { createComposition, enterAgentScope } from '../src/plugins/compose';
import { resetProviders } from '../src/providers/registry';
import { createCurrentAgentScope, createCurrentProcessScope } from './helpers/composition';
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
import type { LoadedTool } from '@capekai/tool';

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
        tempDir: '/tmp/capek-c4-repair-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

/** A minimal test tool: payload-carrying contribution factory. */
function testTool(name: string, _order?: number): LoadedTool {
  return {
    definition: {
      name,
      description: `Test tool ${name}.`,
      inputSchema: { type: 'object', properties: {} },
      timeout: 5000,
    },
    execute: async () => ({ success: true, result: { name } }),
    path: 'builtin:test',
  };
}

/** A capability plugin contributing the given tools with payloads. */
function testCapabilityPlugin(
  id: string,
  tools: readonly LoadedTool[],
): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    setup(context) {
      tools.forEach((loaded, index) => {
        context.contributeTool({
          id: `${id}.${loaded.definition.name}`,
          order: index,
          definition: loaded.definition as KernelToolDefinition,
          payload: loaded,
        });
      });
    },
  };
}

async function facadeComposition(extraPlugins: readonly CapekPlugin<unknown>[]) {
  return createComposition(await createCurrentProcessScope(), {
    storage: createInMemoryStorageBundle(),
    configuration: createDefaultRuntimeConfiguration(),
    host: minimalHost(),
    contextSources: {},
    workspaceToolDiscovery: {},
    sandboxController: new SandboxController(),
    providerOverrides: new Map(),
    profilePlugins: extraPlugins,
  });
}

type LooseToolExecute = (
  args: Record<string, unknown>,
  options: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

afterEach(async () => {
  resetProviders();
});

afterEach(async () => {
  resetProviders();
});

beforeEach(() => {
  configureRuntimeHost(minimalHost());
});

describe('contributed tool resolver with optional capability dependencies', () => {
  test('a minimal facade composition activates and derives an empty-plus-retrieval resolver', async () => {
    const { agentScope } = await facadeComposition([]);

    expect(agentScope.snapshot().status).toBe('active');
    expect(agentScope.listTools().map((tool) => tool.definition.name)).toEqual([
      'retrieve-tool-output',
    ]);
    const resolver = agentScope.require(capekToolResolverKey);
    expect(resolver.list().map((entry) => entry.definition.name)).toEqual([
      'retrieve-tool-output',
    ]);
    expect(resolver.get('read-file')).toBeNull();

    await agentScope.dispose();
  });

  test('a partial facade composition activates and derives only the installed tools', async () => {
    const { agentScope } = await facadeComposition([
      testCapabilityPlugin('test.filesystem', [testTool('read-file', 0), testTool('write-file', 1)]),
      testCapabilityPlugin('test.question', [testTool('question', 0)]),
    ]);

    expect(agentScope.snapshot().status).toBe('active');
    expect(agentScope.listTools().map((tool) => tool.definition.name as string)).toEqual([
      'read-file',
      'question',
      'write-file',
      'retrieve-tool-output',
    ]);
    const resolver = agentScope.require(capekToolResolverKey);
    expect(resolver.list().map((entry) => entry.definition.name)).toEqual([
      'read-file',
      'question',
      'write-file',
      'retrieve-tool-output',
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

  test('a scoped minimal profile assembles the retrieval tool only', async () => {
    const { agentScope } = await facadeComposition([]);

    await enterAgentScope(agentScope, async () => {
      expect(agentScope.require(capekToolResolverKey).list().map((entry) => entry.definition.name))
        .toEqual(['retrieve-tool-output']);
      const tools = await buildAiSdkTools({
        toolNames: ['retrieve-tool-output'],
        workspacePath: undefined,
        workspaceId: undefined,
        sessionId: 'scoped-minimal-session',
      });
      expect(Object.keys(tools)).toEqual(['retrieve-tool-output']);
    });

    await agentScope.dispose();
  });

  test('a scoped full catalog includes retrieval exactly once with session-scoped pages', async () => {
    const { agentScope } = await facadeComposition([
      testCapabilityPlugin('test.filesystem', [testTool('read-file', 0), testTool('write-file', 1)]),
    ]);

    await enterAgentScope(agentScope, async () => {
      const resolver = agentScope.require(capekToolResolverKey);
      const toolNames = resolver.list().map((entry) => entry.definition.name);
      expect(toolNames).toEqual(['read-file', 'write-file', 'retrieve-tool-output']);

      const artifact = await createToolOutputArtifact({
        sessionId: 'scoped-catalog-session',
        toolCallId: 'call-1',
        toolName: 'read-file',
        content: 'x'.repeat(2000),
        format: 'text',
      });
      const foreign = await createToolOutputArtifact({
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
      expect(Object.keys(tools)).toHaveLength(3);
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
  test('installs the C5 domain plugins with the exact contributed inventory', async () => {
    configureRuntimeHost(minimalHost());
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);

    const tools = agentScope.listTools();
    expect(tools.map((tool) => tool.definition.name as string)).toEqual([
      'retrieve-tool-output',
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
        tool.pluginId === CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID
        || tool.pluginId === CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID
        || tool.pluginId === CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID
        || tool.pluginId === CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID
        || tool.pluginId === CURRENT_MEMORY_DOMAIN_PLUGIN_ID
        || tool.pluginId === CURRENT_SKILLS_DOMAIN_PLUGIN_ID
        || tool.pluginId === 'current.tool-output-policy',
      ).toBe(true);
    }
    expect(agentScope.optional(capekToolResolverKey)).toBeUndefined();

    await agentScope.dispose();
    await processScope.dispose();
  });
});
