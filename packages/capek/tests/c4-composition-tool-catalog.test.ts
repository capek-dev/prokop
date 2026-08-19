/**
 * C4 composition tool catalog tests.
 *
 * Pins that createComposition composes zero baked-in tools and that the
 * tool resolver and preconfig tool names derive from the composed scope's
 * effective contributed tool payloads (retrieve-tool-output arrives through
 * the tool-output policy plugin's own contribution; loadedToolsPlugin
 * contributes caller tools).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createComposition, createProcessScope, facadeProcessPlugins } from '@capekai/core/composition';
import { createSingleModelConfiguration, resolveModelSpecifier } from '@capekai/core/configuration';
import { createStandaloneHost } from '@capekai/core/hosts';
import { SandboxProvider } from '@capekai/core/sandbox';
import { createInMemoryStorageBundle } from '@capekai/core/storage';
import { loadedToolsPlugin } from '@capekai/core/plugins';
import { SandboxController } from '../src/sandbox/controller';
import { capekToolResolverKey } from '../src/plugins/service-keys';
import type { ToolRegistryResolver } from '../src/tools/registry';
import { retrieveToolOutputStandardTool } from '../src/tool-output/policy';
import type { LoadedTool } from '@capekai/tool';

const roots: string[] = [];

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'capek-c4-composition-'));
  roots.push(path);
  return path;
}

afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

const echoTool: LoadedTool = {
  definition: {
    name: 'custom-echo',
    description: 'Echoes its input.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    timeout: 5000,
  },
  execute: async (input) => ({ success: true, result: { echoed: input.text } }),
  path: 'builtin:test',
};

async function compose(withTools: LoadedTool[] = []) {
  const root = await workspace();
  const selection = resolveModelSpecifier('openai/gpt-4o-mini');
  const processScope = await createProcessScope([...facadeProcessPlugins()]);
  const composition = await createComposition(processScope, {
    storage: createInMemoryStorageBundle(),
    configuration: createSingleModelConfiguration(selection),
    host: createStandaloneHost({ workspace: root, sandboxActive: true, tempRoot: join(root, 'temp') }),
    contextSources: {},
    workspaceToolDiscovery: {},
    sandboxController: new SandboxController(),
    providerOverrides: new Map([['sandbox', new SandboxProvider()]]),
    profilePlugins: withTools.length ? [loadedToolsPlugin('test.tools', withTools)] : [],
  });
  return composition;
}

describe('composition tool defaults derive from contributed tools', () => {
  test('createComposition composes no baked-in tools; retrieval arrives via the tool-output policy contribution', async () => {
    const { agentScope, processScope } = await compose();

    const tools = agentScope.listTools();
    expect(tools.map((tool) => tool.definition.name)).toEqual(['retrieve-tool-output']);
    for (const tool of tools) {
      expect(tool.visible).toBe(true);
    }

    const resolver = agentScope.require(capekToolResolverKey) as ToolRegistryResolver;
    expect(resolver.list().map((entry) => entry.definition.name)).toEqual(['retrieve-tool-output']);
    expect(resolver.get('retrieve-tool-output')).toBe(retrieveToolOutputStandardTool);
    expect(resolver.get('read-file')).toBeNull();

    await agentScope.dispose();
    await processScope.dispose();
  });

  test('two compositions keep independent contributed tool catalogs', async () => {
    const a = await compose([echoTool]);
    const b = await compose([echoTool]);

    const resolverA = a.agentScope.require(capekToolResolverKey) as ToolRegistryResolver;
    const resolverB = b.agentScope.require(capekToolResolverKey) as ToolRegistryResolver;
    expect(resolverA).not.toBe(resolverB);
    expect(resolverA.get('custom-echo')).toBe(echoTool);
    expect(resolverB.get('custom-echo')).toBe(echoTool);
    expect(a.agentScope.listTools().map((tool) => tool.definition.name))
      .toEqual(b.agentScope.listTools().map((tool) => tool.definition.name));

    await a.agentScope.dispose();
    await a.processScope.dispose();
    await b.agentScope.dispose();
    await b.processScope.dispose();
  });

  test('a custom tool contributed through loadedToolsPlugin lands in the resolver and the visible tool list', async () => {
    const { agentScope } = await compose([echoTool]);
    expect(agentScope.listTools().map((tool) => tool.definition.name)).toEqual([
      'retrieve-tool-output',
      'custom-echo',
    ]);

    const resolver = agentScope.require(capekToolResolverKey) as ToolRegistryResolver;
    expect(resolver.get('custom-echo')).toBe(echoTool);

    await agentScope.dispose();
  });
});
