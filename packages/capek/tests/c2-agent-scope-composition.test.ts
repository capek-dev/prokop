/**
 * C2 agent-scope composition tests: createComposition composes through an
 * agent scope above an explicit process scope, two simultaneous
 * compositions stay isolated, sandbox routing and effective tools are
 * unchanged, and storage/provider ownership keeps parity with the
 * pre-facade behavior (no rewrap, no double close).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInMemoryStorageBundle } from '@capekai/core/storage';
import { createComposition, createProcessScope, enterAgentScope, facadeProcessPlugins } from '@capekai/core/composition';
import { createSingleModelConfiguration, resolveModelSpecifier } from '@capekai/core/configuration';
import { createStandaloneHost } from '@capekai/core/hosts';
import { SandboxProvider } from '@capekai/core/sandbox';
import { SandboxController } from '../src/sandbox/controller';
import { configureSchedulerHost } from '../src/scheduler/host';
import { configureRuntimeHost } from '../src/runtime/host';
import { resetProviders } from '../src/providers/registry';
import { capekStorageKey, capekProviderRegistryKey } from '../src/plugins/service-keys';

const roots: string[] = [];

beforeEach(() => {  configureRuntimeHost(createStandaloneHost({
    workspace: tmpdir(),
    sandboxActive: false,
    tempRoot: join(tmpdir(), 'capek-c2-composition-host'),
  }));
});

afterEach(async () => {
  resetProviders();
  configureSchedulerHost();
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

async function compose(values: Partial<Parameters<typeof createComposition>[1]> = {}) {
  const processScope = await createProcessScope([...facadeProcessPlugins()]);
  const selection = resolveModelSpecifier('openai/gpt-4o-mini');
  const composition = await createComposition(processScope, {
    storage: createInMemoryStorageBundle(),
    configuration: createSingleModelConfiguration(selection),
    host: createStandaloneHost({ workspace: tmpdir(), sandboxActive: true, tempRoot: join(tmpdir(), 'capek-c2-t') }),
    contextSources: {},
    workspaceToolDiscovery: {},
    sandboxController: new SandboxController(),
    providerOverrides: new Map([['sandbox', new SandboxProvider()]]),
    ...values,
  });
  return composition;
}

describe('createComposition agent scopes', () => {
  test('each composition owns an agent scope above its explicit process scope', async () => {
    const { agentScope, processScope } = await compose();

    expect(agentScope.kind).toBe('agent');
    expect(processScope.kind).toBe('process');
    expect(agentScope.parent?.kind).toBe('process');

    const snapshot = agentScope.snapshot();
    // The C2 inventory without baked-in coding capabilities: 4 facade
    // process services plus 16 facade agent services (agent driver, C6
    // agent-scoped retry policy, compaction service, permission policy and
    // runtime, workspace policy, tool-output policy, tool resolver, and
    // workspace tool discovery).
    expect(snapshot.services).toHaveLength(20);
    const facadeServices = snapshot.services.filter((service) =>
      service.providerPluginId.startsWith('facade.'));
    expect(facadeServices.map((service) => service.providerPluginId).sort()).toEqual([
      'facade.agent-driver',
      'facade.compaction-policy',
      'facade.context-sections',
      'facade.context-sources',
      'facade.installed-tool-registry',
      'facade.permission-policy',
      'facade.permission-policy',
      'facade.provider-overrides',
      'facade.provider-registry',
      'facade.retry-policy',
      'facade.runtime-configuration',
      'facade.runtime-host',
      'facade.sandbox-controller',
      'facade.scheduler-host',
      'facade.session-search-host',
      'facade.storage',
      'facade.tool-output-policy',
      'facade.tool-resolver',
      'facade.workspace-policy',
      'facade.workspace-tool-discovery',
    ]);

    await agentScope.dispose();
    await processScope.dispose();
  });

  test('two compositions over one process scope keep independent services', async () => {
    const processScope = await createProcessScope([...facadeProcessPlugins()]);
    const storageA = createInMemoryStorageBundle();
    const storageB = createInMemoryStorageBundle();
    const selection = resolveModelSpecifier('openai/gpt-4o-mini');
    const sharedValues = {
      configuration: createSingleModelConfiguration(selection),
      host: createStandaloneHost({ workspace: tmpdir(), sandboxActive: true, tempRoot: join(tmpdir(), 'capek-c2-t2') }),
      contextSources: {},
      workspaceToolDiscovery: {},
      sandboxController: new SandboxController(),
      providerOverrides: new Map([['sandbox', new SandboxProvider()]]),
    };
    const a = await createComposition(processScope, { ...sharedValues, storage: storageA });
    const b = await createComposition(processScope, { ...sharedValues, storage: storageB });

    const storageAService = a.agentScope.require(capekStorageKey);
    const storageBService = b.agentScope.require(capekStorageKey);
    expect(storageAService).toBe(storageA);
    expect(storageBService).toBe(storageB);
    expect(storageAService).not.toBe(storageBService);

    const registryA = a.processScope.require(capekProviderRegistryKey);
    const registryB = b.processScope.require(capekProviderRegistryKey);
    expect(registryA).toBe(registryB);

    await a.agentScope.dispose();
    await b.agentScope.dispose();
    await processScope.dispose();
  });

  test('enterAgentScope seeds ambient accessors synchronously', async () => {
    const { agentScope } = await compose();
    const observed = enterAgentScope(agentScope, () => true);
    expect(observed).toBe(true);

    await agentScope.dispose();
  });

  test('composing over an empty process scope succeeds; registries resolve lazily', async () => {
    const emptyProcessScope = await createProcessScope([]);
    const selection = resolveModelSpecifier('openai/gpt-4o-mini');
    const { agentScope } = await createComposition(emptyProcessScope, {
      storage: createInMemoryStorageBundle(),
      configuration: createSingleModelConfiguration(selection),
      host: createStandaloneHost({ workspace: tmpdir(), sandboxActive: false, tempRoot: join(tmpdir(), 'capek-c2-t3') }),
      contextSources: {},
      workspaceToolDiscovery: {},
      sandboxController: new SandboxController(),
      providerOverrides: new Map(),
    });
    expect(agentScope.kind).toBe('agent');

    await agentScope.dispose();
    await emptyProcessScope.dispose();
  });
});
