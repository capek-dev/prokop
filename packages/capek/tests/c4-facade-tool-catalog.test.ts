/**
 * C4 facade tool catalog tests.
 *
 * Pins that createAgent composes the coding bundle and that the facade's
 * tool resolver and preconfig tool names derive from the composed scope's
 * effective contributed tools, with the current defaults preserved.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgent } from '@capekai/core';
import { getFacadeComposition } from '../src/facade/create-agent';
import { resetSharedProcessScopeForTests } from '../src/plugins/compose';
import { capekToolResolverKey } from '../src/plugins/service-keys';
import {
  CODING_CAPABILITY_KEYS,
} from '../src/plugins/coding-capabilities';
import type { SandboxControlEvent, SandboxHistoryEntry } from '../src/sandbox/types';
import { retrieveToolOutputStandardTool } from '../src/tool-output/policy';
import { getStandardTool, STANDARD_TOOL_NAMES } from '../src/tools/standard-tools';

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
  test('createAgent composes the coding bundle and derives the resolver from effective contributions', async () => {
    const root = await workspace();
    const agent = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });

    const { agentScope } = await getFacadeComposition(agent);

    const tools = agentScope.listTools();
    expect(tools.map((tool) => tool.definition.name)).toEqual([...STANDARD_TOOL_NAMES]);
    for (const tool of tools) {
      expect(tool.visible).toBe(true);
      expect(tool.pluginId.startsWith('coding.')).toBe(true);
    }

    const snapshot = agentScope.snapshot();
    const codingServices = snapshot.services.filter((service) =>
      CODING_CAPABILITY_KEYS.some((key) => key.id === service.keyId));
    expect(codingServices.map((service) => service.keyId).sort()).toEqual(
      CODING_CAPABILITY_KEYS.map((key) => key.id).sort(),
    );
    for (const service of codingServices) {
      expect(service.providerPluginId.startsWith('coding.')).toBe(true);
    }

    const resolver = agentScope.require(capekToolResolverKey);
    expect(resolver.list().map((entry) => entry.definition.name)).toEqual([...STANDARD_TOOL_NAMES]);
    expect(resolver.get('read-file')).toBe(getStandardTool('read-file'));
    expect(resolver.get('question')).toBe(getStandardTool('question'));
    expect(resolver.get('retrieve-tool-output')).toBe(retrieveToolOutputStandardTool);

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
      'read-file',
      'write-file',
      'edit',
      'edit-range',
      'apply-patch',
      'ls',
      'glob',
      'grep',
      'shell',
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
    expect(resolverA.get('read-file')).toBe(getStandardTool('read-file'));
    expect(resolverB.get('read-file')).toBe(getStandardTool('read-file'));
    expect(compositionA.agentScope.listTools().map((tool) => tool.definition.name))
      .toEqual(compositionB.agentScope.listTools().map((tool) => tool.definition.name));

    await agentA.close();
    await agentB.close();
  });
});
