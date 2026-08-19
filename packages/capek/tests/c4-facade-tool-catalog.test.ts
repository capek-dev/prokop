/**
 * C4 facade tool catalog tests.
 *
 * Pins that createAgent composes zero baked-in tools and that the facade's
 * tool resolver and preconfig tool names derive from the composed scope's
 * effective contributed tool payloads (retrieve-tool-output arrives through
 * the tool-output policy plugin's own contribution).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgent } from '@capekai/core';
import { getFacadeComposition } from '../src/facade/create-agent';
import { resetSharedProcessScopeForTests } from '../src/plugins/compose';
import { capekToolResolverKey } from '../src/plugins/service-keys';
import type { SandboxControlEvent, SandboxHistoryEntry } from '../src/sandbox/types';
import { retrieveToolOutputStandardTool } from '../src/tool-output/policy';
import type { LoadedTool } from '@capekai/tool';

const roots: string[] = [];

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'capek-c4-facade-'));
  roots.push(path);
  return path;
}

function captureHistory(onEvent: (event: SandboxControlEvent) => void, history: SandboxHistoryEntry[]) {
  return (event: SandboxControlEvent): void => {
    if (event.type === 'sandbox.history') {
      history.splice(0, history.length, ...event.entries);
    }
    onEvent(event);
  };
}

afterEach(async () => {
  await resetSharedProcessScopeForTests();
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('facade tool defaults derive from contributed tools', () => {
  test('createAgent composes no baked-in tools; retrieval arrives via the tool-output policy contribution', async () => {
    const root = await workspace();
    const agent = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });

    const { agentScope } = await getFacadeComposition(agent);

    const tools = agentScope.listTools();
    expect(tools.map((tool) => tool.definition.name)).toEqual(['retrieve-tool-output']);
    for (const tool of tools) {
      expect(tool.visible).toBe(true);
    }

    const resolver = agentScope.require(capekToolResolverKey);
    expect(resolver.list().map((entry) => entry.definition.name)).toEqual(['retrieve-tool-output']);
    expect(resolver.get('retrieve-tool-output')).toBe(retrieveToolOutputStandardTool);
    expect(resolver.get('read-file')).toBeNull();

    await agent.close();
  });

  test('facade defaults keep the exact advertised tools without interaction', async () => {
    const root = await workspace();
    const history: SandboxHistoryEntry[] = [];
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: {
        onEvent: captureHistory(() => {}, history),
      },
    });

    const result = await agent.run('inspect available tools');

    expect(result.status).toBe('completed');
    const entry = history.at(-1)!;
    expect(entry.context.tools.map((tool) => tool.name)).toEqual([
      'retrieve-tool-output',
    ]);

    await agent.close();
  });

  test('two simultaneous facade agents keep independent contributed tool catalogs', async () => {
    const root = await workspace();
    const agentA = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });
    const agentB = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });

    const compositionA = await getFacadeComposition(agentA);
    const compositionB = await getFacadeComposition(agentB);

    const resolverA = compositionA.agentScope.require(capekToolResolverKey);
    const resolverB = compositionB.agentScope.require(capekToolResolverKey);
    expect(resolverA).not.toBe(resolverB);
    expect(resolverA.get('retrieve-tool-output')).toBe(retrieveToolOutputStandardTool);
    expect(resolverB.get('retrieve-tool-output')).toBe(retrieveToolOutputStandardTool);
    expect(compositionA.agentScope.listTools().map((tool) => tool.definition.name))
      .toEqual(compositionB.agentScope.listTools().map((tool) => tool.definition.name));

    await agentA.close();
    await agentB.close();
  });

  test('a custom tool contributed through profilePlugins lands in the resolver and the model tool list', async () => {
    const customTool: LoadedTool = {
      definition: {
        name: 'custom-echo',
        description: 'Echoes its input.',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        timeout: 5000,
      },
      execute: async (input) => ({ success: true, result: { echoed: input.text } }),
      path: 'builtin:test',
    };

    const root = await workspace();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: true,
      tools: [customTool],
    });

    const { agentScope } = await getFacadeComposition(agent);
    expect(agentScope.listTools().map((tool) => tool.definition.name)).toEqual([
      'retrieve-tool-output',
      'custom-echo',
    ]);

    const resolver = agentScope.require(capekToolResolverKey);
    expect(resolver.get('custom-echo')).toBe(customTool);

    await agent.close();
  });
});
