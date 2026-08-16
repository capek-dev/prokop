/**
 * C4 coding bundle tests.
 *
 * Pins the coding bundle inventory and parity, the minimal profile, the
 * service-derived visibility decision, the contributed tool resolver, the
 * additive PluginContext.listTools surface, and exact session-scoped
 * tool-output retrieval through the contributed tool executor.
 */

import { describe, expect, test } from 'bun:test';
import type { ToolContext } from '@jean2/sdk';
import { createInMemoryStorageBundle, withStorage } from '@capekai/core/storage';
import { codingAgentBundle, CODING_AGENT_BUNDLE_PLUGIN_IDS } from '../src/bundles/coding-agent';
import { minimalAgentBundle } from '../src/bundles/minimal-agent';
import { createAgentScope, createProcessScope } from '../src/kernel';
import type { CapekPlugin, PluginContext, ToolDefinition as KernelToolDefinition } from '../src/kernel/types';
import {
  capekFilesystemCapabilityKey,
  capekQuestionCapabilityKey,
  capekShellCapabilityKey,
  codingCapabilityPlugin,
  STANDARD_CODING_CAPABILITIES,
} from '../src/plugins/coding-capabilities';
import { createContributedToolResolver } from '../src/plugins/tool-catalog';
import { createToolOutputArtifact } from '../src/storage/runtime';
import { retrieveToolOutputStandardTool } from '../src/tools/tool-output-artifacts';
import { getStandardTool, STANDARD_TOOL_NAMES } from '../src/tools/standard-tools';

const BUILTIN_PATH = 'builtin:@capekai/core';

async function composeAgent(plugins: readonly CapekPlugin<unknown>[]) {
  const processScope = await createProcessScope([]);
  const agentScope = await createAgentScope(processScope, [...plugins]);
  return { processScope, agentScope };
}

describe('codingAgentBundle inventory and parity', () => {
  test('the bundle installs six deterministic capability plugins in order', () => {
    const plugins = codingAgentBundle();
    expect(plugins.map((plugin) => plugin.id)).toEqual([...CODING_AGENT_BUNDLE_PLUGIN_IDS]);
    for (const plugin of plugins) {
      expect(plugin.scope).toBe('agent');
      expect(plugin.provides).toHaveLength(1);
    }
  });

  test('the composed bundle contributes the exact current standard tool set in exact order', async () => {
    const { processScope, agentScope } = await composeAgent(codingAgentBundle());
    const tools = agentScope.listTools();

    expect(tools.map((tool) => tool.definition.name)).toEqual([...STANDARD_TOOL_NAMES]);
    for (const tool of tools) {
      expect(tool.visible).toBe(true);
      expect(tool.hiddenReasons).toEqual([]);
    }

    await agentScope.dispose();
    await processScope.dispose();
  });

  test('every contribution carries the exact current LoadedTool definition by deep parity', async () => {
    const { processScope, agentScope } = await composeAgent(codingAgentBundle());
    const tools = agentScope.listTools();

    for (const tool of tools) {
      const name = tool.definition.name as string;
      if (name === 'retrieve-tool-output') {
        expect(tool.definition).toEqual(retrieveToolOutputStandardTool.definition as KernelToolDefinition);
        continue;
      }
      const standard = getStandardTool(name);
      expect(standard, name).not.toBeNull();
      expect(tool.definition).toEqual(standard!.definition as KernelToolDefinition);
    }

    await agentScope.dispose();
    await processScope.dispose();
  });

  test('pins contribution orders and owning capability plugins', async () => {
    const { processScope, agentScope } = await composeAgent(codingAgentBundle());
    const tools = agentScope.listTools();

    const EXPECTED: Record<string, { order: number; pluginId: string }> = {
      'read-file': { order: 100, pluginId: 'coding.filesystem' },
      'write-file': { order: 101, pluginId: 'coding.filesystem' },
      edit: { order: 200, pluginId: 'coding.editing' },
      'edit-range': { order: 201, pluginId: 'coding.editing' },
      'apply-patch': { order: 202, pluginId: 'coding.editing' },
      ls: { order: 300, pluginId: 'coding.search' },
      glob: { order: 301, pluginId: 'coding.search' },
      grep: { order: 302, pluginId: 'coding.search' },
      shell: { order: 400, pluginId: 'coding.shell' },
      question: { order: 500, pluginId: 'coding.question' },
      'retrieve-tool-output': { order: 600, pluginId: 'coding.tool-output' },
    };
    for (const tool of tools) {
      expect(tool.order, tool.definition.name as string).toBe(EXPECTED[tool.definition.name as string].order);
      expect(tool.pluginId, tool.definition.name as string).toBe(EXPECTED[tool.definition.name as string].pluginId);
    }

    await agentScope.dispose();
    await processScope.dispose();
  });

  test('question keeps its capabilities array and every tool keeps its timeout', async () => {
    const { processScope, agentScope } = await composeAgent(codingAgentBundle());
    const tools = agentScope.listTools();

    const question = tools.find((tool) => tool.definition.name === 'question');
    expect(question?.definition.capabilities).toEqual(['interactive-user-input']);
    expect(question?.definition.timeout).toBe(300_000);
    expect(tools.find((tool) => tool.definition.name === 'shell')?.definition.timeout).toBe(60_000);
    expect(tools.find((tool) => tool.definition.name === 'edit-range')?.definition.timeout).toBe(180_000);

    await agentScope.dispose();
    await processScope.dispose();
  });
});

describe('minimal profile', () => {
  test('the minimal bundle installs no plugins and exposes no coding tools', async () => {
    expect(minimalAgentBundle()).toEqual([]);
    const { processScope, agentScope } = await composeAgent(minimalAgentBundle());

    expect(agentScope.listTools()).toEqual([]);
    const resolver = createContributedToolResolver(agentScope);
    expect(resolver.list()).toEqual([]);
    expect(resolver.get('read-file')).toBeNull();

    await agentScope.dispose();
    await processScope.dispose();
  });
});

describe('service-derived tool visibility', () => {
  test('a partial capability profile exposes only the installed capabilities', async () => {
    const partial = [
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
    ];
    const { processScope, agentScope } = await composeAgent(partial);

    expect(agentScope.listTools().map((tool) => tool.definition.name)).toEqual([
      'read-file',
      'write-file',
      'question',
    ]);
    const resolver = createContributedToolResolver(agentScope);
    expect(resolver.list().map((entry) => entry.definition.name)).toEqual([
      'read-file',
      'write-file',
      'question',
    ]);
    expect(resolver.get('shell')).toBeNull();

    await agentScope.dispose();
    await processScope.dispose();
  });

  test('a contribution without its required capability service is hidden and never resolves', async () => {
    const orphan: CapekPlugin<unknown> = {
      id: 'test.orphan-shell-tool',
      scope: 'agent',
      setup(context: PluginContext) {
        context.contributeTool({
          id: 'test.orphan-shell',
          order: 1,
          definition: { name: 'orphan-shell', description: 'orphaned shell contribution' },
          requiredCapabilities: [capekShellCapabilityKey],
        });
      },
    };
    const { processScope, agentScope } = await composeAgent([orphan]);

    const tools = agentScope.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].visible).toBe(false);
    expect(tools[0].hiddenReasons).toEqual(["missing required capability 'capek.shell-capability'"]);
    expect(createContributedToolResolver(agentScope).list()).toEqual([]);

    await agentScope.dispose();
    await processScope.dispose();
  });
});

describe('contributed tool resolver', () => {
  test('resolves the exact LoadedTool payloads by identity in exact order', async () => {
    const { processScope, agentScope } = await composeAgent(codingAgentBundle());
    const resolver = createContributedToolResolver(agentScope);

    expect(resolver.list().map((entry) => entry.definition.name)).toEqual([...STANDARD_TOOL_NAMES]);
    for (const name of STANDARD_TOOL_NAMES) {
      const resolved = resolver.get(name);
      expect(resolved, name).not.toBeNull();
      expect(resolved!.path, name).toBe(BUILTIN_PATH);
      expect(typeof resolved!.execute, name).toBe('function');
    }
    expect(resolver.get('read-file')).toBe(getStandardTool('read-file'));
    expect(resolver.get('retrieve-tool-output')).toBe(retrieveToolOutputStandardTool);
    expect(resolver.get('task')).toBeNull();
    expect(resolver.get('memory')).toBeNull();

    await agentScope.dispose();
    await processScope.dispose();
  });
});

describe('additive PluginContext.listTools surface', () => {
  test('a dependent plugin observes earlier capability contributions during setup', async () => {
    let observedNames: string[] = [];
    const observer: CapekPlugin<unknown> = {
      id: 'test.tool-observer',
      scope: 'agent',
      provides: [capekQuestionCapabilityKey],
      requires: [capekFilesystemCapabilityKey],
      setup(context: PluginContext) {
        observedNames = context.listTools()
          .filter((tool) => tool.visible)
          .map((tool) => tool.definition.name as string);
        context.provide(
          capekQuestionCapabilityKey,
          STANDARD_CODING_CAPABILITIES.question,
        );
      },
    };
    const { processScope, agentScope } = await composeAgent([
      codingCapabilityPlugin(
        'coding.filesystem',
        capekFilesystemCapabilityKey,
        STANDARD_CODING_CAPABILITIES.filesystem,
      ),
      observer,
    ]);

    expect(observedNames).toEqual(['read-file', 'write-file']);
    expect(agentScope.listTools().map((tool) => tool.definition.name)).toEqual([
      'read-file',
      'write-file',
    ]);

    await agentScope.dispose();
    await processScope.dispose();
  });
});

describe('contributed tool-output retrieval', () => {
  test('the contributed retrieve-tool-output executor keeps exact session-scoped retrieval', async () => {
    const storage = createInMemoryStorageBundle();
    withStorage(storage, async () => {
      const artifact = createToolOutputArtifact({
        sessionId: 'session-a',
        toolCallId: 'call-1',
        toolName: 'read-file',
        content: 'x'.repeat(2000),
        format: 'text',
      });

      const context = { sessionId: 'session-a' } as ToolContext;
      const pageResult = await retrieveToolOutputStandardTool.execute(
        { artifactId: artifact.id, offset: 0, limit: 10 },
        context,
      );
      expect(pageResult.success).toBe(true);
      expect((pageResult.result as { content: string }).content).toBe('x'.repeat(10));

      const missing = await retrieveToolOutputStandardTool.execute(
        { artifactId: artifact.id },
        { sessionId: 'other-session' } as ToolContext,
      );
      expect(missing.success).toBe(false);
      expect(missing.error).toBe('Tool output artifact not found');
    });
  });
});
