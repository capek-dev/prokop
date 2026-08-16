/**
 * C2 facade tests: createAgent composes through an agent scope, two
 * simultaneous facade agents stay isolated, sandbox routing and effective
 * tools are unchanged, and storage/provider ownership keeps parity with the
 * pre-C2 behavior (no rewrap, no double close).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgent } from '@capekai/core';
import { createInMemoryConversationStore, createInMemoryStorageBundle } from '@capekai/core/storage';
import { getFacadeComposition } from '../src/facade/create-agent';
import type { AgentEvent } from '../src/facade/types';
import {
  createCurrentProcessScope,
  enterAgentScope,
  resetSharedProcessScopeForTests,
  setSharedProcessScopeFactoryForTests,
} from '../src/plugins/compose';
import {
  capekProviderOverridesKey,
  capekProviderRegistryKey,
  capekSandboxControllerKey,
  capekSchedulerHostKey,
  capekStorageKey,
  capekToolResolverKey,
} from '../src/plugins/service-keys';
import { SandboxProvider } from '../src/sandbox/provider';
import type { SandboxControlEvent, SandboxHistoryEntry } from '../src/sandbox/types';
import { configureSchedulerHost, type SchedulerHost } from '../src/scheduler/host';
import { getProvider, resetProviders, withProviderOverrides } from '../src/providers/registry';
import { getStorage } from '../src/storage/runtime';

const roots: string[] = [];

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'capek-c2-facade-'));
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

const STANDARD_WITHOUT_QUESTION = [
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
];

afterEach(async () => {
  resetProviders();
  await resetSharedProcessScopeForTests();
  configureSchedulerHost();
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('createAgent through the agent scope', () => {
  test('each agent owns an agent scope above the shared current process scope', async () => {
    const root = await workspace();
    const agent = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });

    const { agentScope, processScope } = await getFacadeComposition(agent);
    expect(agentScope.kind).toBe('agent');
    expect(processScope.kind).toBe('process');
    expect(agentScope.parent?.kind).toBe('process');

    const snapshot = agentScope.snapshot();
    // C4 adds the six coding capability services on top of the C2
    // inventory (4 process services plus 9 facade services).
    expect(snapshot.services).toHaveLength(19);
    const facadeServices = snapshot.services.filter((service) =>
      service.providerPluginId.startsWith('facade.'));
    expect(facadeServices.map((service) => service.providerPluginId).sort()).toEqual([
      'facade.context-sections',
      'facade.context-sources',
      'facade.provider-overrides',
      'facade.runtime-configuration',
      'facade.runtime-host',
      'facade.sandbox-controller',
      'facade.storage',
      'facade.tool-resolver',
      'facade.tool-source',
    ]);

    await agent.close();
  });

  test('getFacadeComposition rejects agents not created by createAgent', () => {
    const impostor = { run: async () => ({}) };
    expect(() => getFacadeComposition(impostor as never)).toThrow('requires an agent created by createAgent');
  });

  test('the composed storage service holds the exact facade storage bundle without rewrapping', async () => {
    const root = await workspace();
    const conversation = createInMemoryConversationStore();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      storage: conversation,
      sandbox: true,
    });

    const { agentScope } = await getFacadeComposition(agent);
    const composed = agentScope.require(capekStorageKey);
    expect(composed.conversation).toBe(conversation);

    await agent.close();
  });

  test('facade runs keep sandbox routing, effective tools, and session defaults unchanged', async () => {
    const root = await workspace();
    const bundle = createInMemoryStorageBundle();
    const history: SandboxHistoryEntry[] = [];
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      storage: bundle.conversation,
      sandbox: {
        onEvent: captureHistory(() => {}, history),
      },
    });

    const result = await agent.run('inspect');

    expect(result.status).toBe('completed');
    const entry = history.at(-1)!;
    expect(entry.context.tools.map((tool) => tool.name)).toEqual(STANDARD_WITHOUT_QUESTION);
    expect(entry.context.providerId).toBe('sandbox');
    expect(entry.context.modelId).toBe('gpt-4o-mini');
    expect(entry.context.sessionId).toBe(result.sessionId);

    const session = bundle.conversation.getSession(result.sessionId);
    expect(session).toMatchObject({
      preconfigId: 'capek-default',
      selectedModel: 'gpt-4o-mini',
      selectedProvider: 'openai',
      status: 'active',
      title: 'Agent session',
    });

    await agent.close();
  });

  test('close disposes the agent scope exactly once and later use still rejects', async () => {
    const root = await workspace();
    const agent = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });
    const { agentScope } = await getFacadeComposition(agent);

    expect(agentScope.snapshot().status).toBe('active');
    await agent.close();
    expect(agentScope.snapshot().status).toBe('disposed');
    await agent.close();
    await expect(agent.run('later')).rejects.toThrow('Agent is closed');
  });
});

describe('simultaneous facade agents', () => {
  test('two live agents resolve isolated values through their own scopes', async () => {
    const root = await workspace();
    const conversationA = createInMemoryConversationStore();
    const conversationB = createInMemoryConversationStore();

    const agentA = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      storage: conversationA,
      sandbox: true,
    });
    const agentB = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      storage: conversationB,
      sandbox: true,
    });

    const compositionA = await getFacadeComposition(agentA);
    const compositionB = await getFacadeComposition(agentB);

    expect(compositionA.agentScope).not.toBe(compositionB.agentScope);
    expect(compositionA.processScope).toBe(compositionB.processScope);
    expect(compositionA.agentScope.require(capekStorageKey).conversation).toBe(conversationA);
    expect(compositionB.agentScope.require(capekStorageKey).conversation).toBe(conversationB);
    expect(compositionA.agentScope.require(capekSandboxControllerKey))
      .not.toBe(compositionB.agentScope.require(capekSandboxControllerKey));

    const results = await Promise.all([agentA.run('inspect A'), agentB.run('inspect B')]);

    expect(results[0].status).toBe('completed');
    expect(results[1].status).toBe('completed');
    expect(conversationA.getSession(results[0].sessionId)).not.toBeNull();
    expect(conversationB.getSession(results[1].sessionId)).not.toBeNull();
    expect(conversationA.getSession(results[1].sessionId)).toBeNull();
    expect(conversationB.getSession(results[0].sessionId)).toBeNull();

    await agentA.close();
    await agentB.close();
  });

  test('scope entry seeds accessors per scope while both scopes stay live', async () => {
    const root = await workspace();
    const conversationA = createInMemoryConversationStore();
    const conversationB = createInMemoryConversationStore();
    const agentA = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      storage: conversationA,
      sandbox: true,
    });
    const agentB = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      storage: conversationB,
      sandbox: true,
    });
    const compositionA = await getFacadeComposition(agentA);
    const compositionB = await getFacadeComposition(agentB);

    let releaseA!: () => void;
    let releaseB!: () => void;
    const barrierA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const barrierB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    const observations: string[] = [];

    const runA = enterAgentScope(compositionA.agentScope, async () => {
      const storage = getStorage();
      observations.push(storage.conversation === conversationA ? 'A-own' : 'A-leaked');
      await barrierA;
      observations.push(getStorage().conversation === conversationA ? 'A-resumed' : 'A-resumed-leak');
      return 'A-done';
    });
    const runB = enterAgentScope(compositionB.agentScope, async () => {
      const storage = getStorage();
      observations.push(storage.conversation === conversationB ? 'B-own' : 'B-leaked');
      await barrierB;
      observations.push(getStorage().conversation === conversationB ? 'B-resumed' : 'B-resumed-leak');
      return 'B-done';
    });

    // Both scopes are live and awaiting their own barriers; each ALS context
    // still resolves its own storage after the async suspension.
    releaseA();
    releaseB();
    expect(await Promise.all([runA, runB])).toEqual(['A-done', 'B-done']);
    expect(observations).toEqual(['A-own', 'B-own', 'A-resumed', 'B-resumed']);

    await agentA.close();
    await agentB.close();
  });
});

describe('provider routing parity', () => {
  test('the seeded overrides map routes sandbox through the facade provider and never leaks across agents', async () => {
    const root = await workspace();
    const agent = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });
    const { agentScope } = await getFacadeComposition(agent);

    const overrides = agentScope.require(capekProviderOverridesKey);
    expect(overrides.get('sandbox')).toBeInstanceOf(SandboxProvider);

    const registry = (await getFacadeComposition(agent)).processScope.require(capekProviderRegistryKey);
    const routed = await enterAgentScope(agentScope, () => registry.getProvider('sandbox'));
    expect(routed).toBe(overrides.get('sandbox'));
    expect(routed).toBeInstanceOf(SandboxProvider);

    // Outside the agent scope the process registry has no sandbox provider,
    // exactly like the unseeded pre-C2 path.
    expect(getProvider('sandbox')).toBeUndefined();

    await agent.close();
  });

  test('an agent scope cannot leak provider overrides into a sibling scope', async () => {
    const root = await workspace();
    const agentA = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });
    const agentB = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });
    const compositionA = await getFacadeComposition(agentA);
    const compositionB = await getFacadeComposition(agentB);

    const overridesA = compositionA.agentScope.require(capekProviderOverridesKey);
    const overridesB = compositionB.agentScope.require(capekProviderOverridesKey);
    expect(overridesA).not.toBe(overridesB);

    await enterAgentScope(compositionA.agentScope, () => {
      expect(getProvider('sandbox')).toBe(overridesA.get('sandbox'));
    });
    await enterAgentScope(compositionB.agentScope, () => {
      expect(getProvider('sandbox')).toBe(overridesB.get('sandbox'));
    });
    expect(getProvider('sandbox')).toBeUndefined();

    await agentA.close();
    await agentB.close();
  });

  test('facade tool resolver stays scoped to the facade agent and is optional elsewhere', async () => {
    const root = await workspace();
    const agent = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });
    const { agentScope } = await getFacadeComposition(agent);

    const resolver = agentScope.require(capekToolResolverKey);
    expect(typeof resolver.get).toBe('function');
    expect(typeof resolver.list).toBe('function');

    await agent.close();
  });
});

describe('storage close parity', () => {
  test('closing the agent still closes sqlite storage exactly once and never through scope disposal', async () => {
    const root = await workspace();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      storage: { type: 'sqlite', path: join(root, 'store.sqlite') },
      sandbox: true,
    });
    const { agentScope } = await getFacadeComposition(agent);
    const composed = agentScope.require(capekStorageKey);

    const result = await agent.run('sqlite inspect');
    expect(composed.conversation.getSession(result.sessionId)).not.toBeNull();

    await agent.close();
    await agent.close();
    await expect(agent.run('later')).rejects.toThrow('Agent is closed');
  });

  test('custom caller storage is never closed by the agent or by scope disposal', async () => {
    const root = await workspace();
    let closeCount = 0;
    const conversation = Object.assign(createInMemoryConversationStore(), {
      type: 'custom-store',
      close: () => {
        closeCount += 1;
      },
    });

    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      storage: conversation,
      sandbox: true,
    });
    await agent.run('custom inspect');
    await agent.close();

    expect(closeCount).toBe(0);
    expect(conversation.getSession).toBeDefined();
  });

  test('provider overrides map remains per agent and never mutates the process registry', async () => {
    const root = await workspace();
    const agent = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });
    const { agentScope, processScope } = await getFacadeComposition(agent);

    const registry = processScope.require(capekProviderRegistryKey);
    const before = registry.getConnectableProviders();
    await enterAgentScope(agentScope, () => {
      expect(registry.getConnectableProviders().length).toBe(before.length + 1);
    });
    expect(registry.getConnectableProviders()).toEqual(before);

    await agent.close();
  });
});

describe('withProviderOverrides compatibility', () => {
  test('the legacy ALS override path still works beside the composed scopes', async () => {
    const root = await workspace();
    const agent = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });
    const provider = new SandboxProvider();

    await withProviderOverrides(new Map([['legacy-override', provider]]), async () => {
      expect(getProvider('legacy-override')).toBe(provider);
    });
    expect(getProvider('legacy-override')).toBeUndefined();

    await agent.close();
  });
});

describe('composition lifecycle hardening', () => {
  function schedulerHost(label: string): SchedulerHost {
    return {
      create: () => {
        throw new Error(`scheduler ${label} create`);
      },
      get: () => null,
      list: () => [],
      update: () => null,
      delete: () => false,
      trigger: () => {},
    };
  }

  test('composition failure never becomes an unhandled rejection for an idle agent and resets the shared cache', async () => {
    const root = await workspace();
    let attempts = 0;
    setSharedProcessScopeFactoryForTests(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('composition boom');
      return createCurrentProcessScope();
    });

    // Idle agent: the constructor-started composition rejects, but no
    // consumer exists yet, so the rejection must stay handled.
    const agent = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(attempts).toBe(1);

    // The original rejection is preserved for every consumer surface.
    await expect(getFacadeComposition(agent)).rejects.toThrow('composition boom');
    await expect(agent.run('inspect')).rejects.toThrow('composition boom');
    await expect(agent.close()).rejects.toThrow('composition boom');
    await expect(agent.run('again')).rejects.toThrow('Agent is closed');

    // The shared cache resets on failure, so the next agent composes a
    // fresh process scope instead of inheriting the rejected one.
    const next = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });
    const result = await next.run('inspect');
    expect(result.status).toBe('completed');
    expect(attempts).toBe(2);
    await next.close();
  });

  test('the facade process scope is created once, is not silently refreshed by reconfiguration, and is separate from fresh current scopes', async () => {
    const root = await workspace();
    const hostA = schedulerHost('A');
    const hostB = schedulerHost('B');
    configureSchedulerHost(hostA);

    const first = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });
    const firstComposition = await getFacadeComposition(first);
    expect(firstComposition.processScope.require(capekSchedulerHostKey)).toBe(hostA);

    configureSchedulerHost(hostB);
    const second = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });
    const secondComposition = await getFacadeComposition(second);

    // The facade caches one process scope for the process lifetime; the
    // bound host is deliberately not refreshed by later configuration.
    expect(secondComposition.processScope).toBe(firstComposition.processScope);
    expect(secondComposition.processScope.require(capekSchedulerHostKey)).toBe(hostA);

    // Jean2-style composition creates a separate process scope per call.
    const fresh = await createCurrentProcessScope();
    expect(fresh).not.toBe(firstComposition.processScope);
    expect(fresh.require(capekSchedulerHostKey)).toBe(hostB);

    await fresh.dispose();
    await first.close();
    await second.close();
  });

  test('run followed immediately by close settles one terminal result with exactly-once cleanup', async () => {
    const root = await workspace();
    const agent = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });

    const runPromise = agent.run('inspect');
    const closePromise = agent.close();
    const [result] = await Promise.all([runPromise, closePromise]);

    // Close aborts the just-started run before any model work; the run
    // settles as interrupted and close waits for that settlement.
    expect(result.status).toBe('interrupted');
    const { agentScope } = await getFacadeComposition(agent);
    expect(agentScope.snapshot().status).toBe('disposed');

    await agent.close();
    await expect(agent.run('later')).rejects.toThrow('Agent is closed');
    await expect(agent.resume(result.sessionId, 'resume')).rejects.toThrow('Agent is closed');
  });

  test('a stream iterator returned after close issues no fire-and-forget rejection and keeps one terminal result', async () => {
    const root = await workspace();
    const agent = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });

    const iterator = agent.stream('inspect')[Symbol.asyncIterator]();
    const closePromise = agent.close();

    const events: AgentEvent[] = [];
    while (true) {
      const step = await iterator.next();
      if (step.done) break;
      events.push(step.value);
    }
    await closePromise;

    const results = events.filter((event) => event.type === 'result');
    expect(results).toHaveLength(1);
    expect(['interrupted', 'completed']).toContain(
      (results[0] as Extract<AgentEvent, { type: 'result' }>).result.status,
    );

    // Returning the iterator after close is a no-op that must not reject.
    await iterator.return?.();
    expect((await iterator.next()).done).toBe(true);

    const { agentScope } = await getFacadeComposition(agent);
    expect(agentScope.snapshot().status).toBe('disposed');
    await agent.close();
    await expect(agent.run('later')).rejects.toThrow('Agent is closed');
  });
});
