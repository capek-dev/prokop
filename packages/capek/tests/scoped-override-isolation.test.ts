import { afterEach, describe, expect, test } from 'bun:test';
import { jsonSchema, type Tool } from 'ai';
import type { StorageBundle } from '../src/storage/contracts';
import type { RuntimeConfiguration } from '../src/configuration/contracts';
import { createDefaultRuntimeConfiguration } from '../src/configuration/defaults';
import {
  configureRuntimeConfiguration,
  getRuntimeConfiguration,
  withRuntimeConfiguration,
} from '../src/configuration/runtime';
import {
  getConnectableProviders,
  getProvider,
  registerProvider,
  resetProviders,
  withProviderOverrides,
} from '../src/providers/registry';
import type { ConnectableProvider } from '../src/providers/types';
import {
  configureStorage,
  createSession,
  getStorage,
  withStorage,
} from '../src/storage/runtime';
import { createInMemoryStorageBundle } from '../src/storage/memory';
import {
  configureWorkspaceToolDiscovery,
  discoverWorkspaceTools,
  getWorkspaceToolDiscovery,
  withWorkspaceToolDiscovery,
  type WorkspaceToolDiscovery,
} from '../src/tools/tool-source';

function buildConfiguration(temperature: number): RuntimeConfiguration {
  return {
    ...createDefaultRuntimeConfiguration(),
    getLLMTemperature: () => temperature,
  };
}

function buildProvider(id: string): ConnectableProvider {
  return {
    descriptor: { id, displayName: id, authType: 'none', connectable: false },
    getStatus: () => ({ provider: id, connected: true }),
    connect: async () => ({}),
    disconnect: async () => {},
    onTokensReceived: async () => {},
  };
}

function buildDiscovery(label: string, toolNames: string[]): WorkspaceToolDiscovery {
  return {
    async initializeWorkspace(): Promise<void> {},
    async discoverTools(): Promise<Record<string, Tool>> {
      const discovered: Record<string, Tool> = {};
      for (const name of toolNames) {
        discovered[name] = {
          description: `${label}-${name}`,
          inputSchema: jsonSchema({ type: 'object', properties: {} }),
        };
      }
      return discovered;
    },
  };
}

interface ScopeValues {
  storage: StorageBundle;
  configuration: RuntimeConfiguration;
  providers: ReadonlyMap<string, ConnectableProvider>;
  workspaceToolDiscovery: WorkspaceToolDiscovery;
}

interface ScopeObservation {
  label: 'A' | 'B';
  phase: 'entered' | 'resumed';
  storage: StorageBundle;
  configuration: RuntimeConfiguration;
  sharedProvider: ConnectableProvider | undefined;
  globalOnlyProvider: ConnectableProvider | undefined;
  workspaceToolDiscovery: WorkspaceToolDiscovery;
  discovered: string[];
}

// Follows the actual facade #scope nesting order for the tested seams:
// withStorage -> withRuntimeConfiguration -> withProviderOverrides -> withWorkspaceToolDiscovery
function runScope(
  label: 'A' | 'B',
  values: ScopeValues,
  entered: () => void,
  barrier: Promise<void>,
  observations: ScopeObservation[],
): Promise<string> {
  const observe = (phase: ScopeObservation['phase'], discovered: string[]): void => {
    observations.push({
      label,
      phase,
      storage: getStorage(),
      configuration: getRuntimeConfiguration(),
      sharedProvider: getProvider('shared'),
      globalOnlyProvider: getProvider('global-only'),
      workspaceToolDiscovery: getWorkspaceToolDiscovery(),
      discovered,
    });
  };
  return withStorage(values.storage, () =>
    withRuntimeConfiguration(values.configuration, () =>
      withProviderOverrides(values.providers, () =>
        withWorkspaceToolDiscovery(values.workspaceToolDiscovery, async () => {
          observe('entered', []);
          entered();
          await barrier;
          createSession({
            id: `session-${label}`,
            workspaceId: `workspace-${label}`,
            preconfigId: 'capek-default',
            title: label,
            status: 'active',
            metadata: null,
            parentId: null,
            agentName: null,
          });
          const discovered = Object.keys(await discoverWorkspaceTools(`/workspace-${label}`));
          observe('resumed', discovered);
          return `${label}-done`;
        }))));
}

afterEach(() => {
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeConfiguration();
  configureWorkspaceToolDiscovery();
  resetProviders();
});

describe('scoped override isolation', () => {
  test('keeps two concurrently live agent scopes isolated and restores module defaults', async () => {
    const defaultStorage = createInMemoryStorageBundle();
    const defaultConfiguration = buildConfiguration(0.5);
    const defaultDiscovery = buildDiscovery('default', []);
    const defaultSharedProvider = buildProvider('shared');
    const globalOnlyProvider = buildProvider('global-only');
    configureStorage(defaultStorage);
    configureRuntimeConfiguration(defaultConfiguration);
    configureWorkspaceToolDiscovery(defaultDiscovery);
    registerProvider(defaultSharedProvider);
    registerProvider(globalOnlyProvider);

    const storageA = createInMemoryStorageBundle();
    const storageB = createInMemoryStorageBundle();
    const configurationA = buildConfiguration(0.1);
    const configurationB = buildConfiguration(0.9);
    const providerA = buildProvider('shared');
    const providerB = buildProvider('shared');
    const toolSourceA = buildDiscovery('A', ['a-tool']);
    const toolSourceB = buildDiscovery('B', ['b-tool']);

    let releaseEnteredA!: () => void;
    let releaseEnteredB!: () => void;
    const aEntered = new Promise<void>((resolve) => {
      releaseEnteredA = resolve;
    });
    const bEntered = new Promise<void>((resolve) => {
      releaseEnteredB = resolve;
    });
    let releaseBarrierA!: () => void;
    let releaseBarrierB!: () => void;
    const barrierA = new Promise<void>((resolve) => {
      releaseBarrierA = resolve;
    });
    const barrierB = new Promise<void>((resolve) => {
      releaseBarrierB = resolve;
    });

    const observations: ScopeObservation[] = [];
    const aRun = runScope('A', {
      storage: storageA,
      configuration: configurationA,
      providers: new Map([['shared', providerA]]),
      workspaceToolDiscovery: toolSourceA,
    }, releaseEnteredA, barrierA, observations);
    const bRun = runScope('B', {
      storage: storageB,
      configuration: configurationB,
      providers: new Map([['shared', providerB]]),
      workspaceToolDiscovery: toolSourceB,
    }, releaseEnteredB, barrierB, observations);

    await Promise.all([aEntered, bEntered]);

    const enteredA = observations.find((observation) => observation.label === 'A' && observation.phase === 'entered')!;
    const enteredB = observations.find((observation) => observation.label === 'B' && observation.phase === 'entered')!;
    expect(enteredA.storage).toBe(storageA);
    expect(enteredB.storage).toBe(storageB);
    expect(enteredA.configuration.getLLMTemperature()).toBe(0.1);
    expect(enteredB.configuration.getLLMTemperature()).toBe(0.9);
    expect(enteredA.sharedProvider).toBe(providerA);
    expect(enteredB.sharedProvider).toBe(providerB);
    expect(enteredA.globalOnlyProvider).toBe(globalOnlyProvider);
    expect(enteredB.globalOnlyProvider).toBe(globalOnlyProvider);
    expect(enteredA.workspaceToolDiscovery).toBe(toolSourceA);
    expect(enteredB.workspaceToolDiscovery).toBe(toolSourceB);

    releaseBarrierA();
    releaseBarrierB();
    await Promise.all([aRun, bRun]);

    const resumedA = observations.find((observation) => observation.label === 'A' && observation.phase === 'resumed')!;
    const resumedB = observations.find((observation) => observation.label === 'B' && observation.phase === 'resumed')!;
    expect(resumedA.storage).toBe(storageA);
    expect(resumedB.storage).toBe(storageB);
    expect(resumedA.configuration.getLLMTemperature()).toBe(0.1);
    expect(resumedB.configuration.getLLMTemperature()).toBe(0.9);
    expect(resumedA.sharedProvider).toBe(providerA);
    expect(resumedB.sharedProvider).toBe(providerB);
    expect(resumedA.workspaceToolDiscovery).toBe(toolSourceA);
    expect(resumedB.workspaceToolDiscovery).toBe(toolSourceB);
    expect(resumedA.discovered).toEqual(['a-tool']);
    expect(resumedB.discovered).toEqual(['b-tool']);

    expect((await storageA.conversation.getSession('session-A'))?.id).toBe('session-A');
    expect((await storageB.conversation.getSession('session-B'))?.id).toBe('session-B');
    expect(await storageA.conversation.getSession('session-B')).toBeNull();
    expect(await storageB.conversation.getSession('session-A')).toBeNull();
    expect(await defaultStorage.conversation.getSession('session-A')).toBeNull();
    expect(await defaultStorage.conversation.getSession('session-B')).toBeNull();

    expect(getStorage()).toBe(defaultStorage);
    expect(getRuntimeConfiguration()).toBe(defaultConfiguration);
    expect(getProvider('shared')).toBe(defaultSharedProvider);
    expect(getWorkspaceToolDiscovery()).toBe(defaultDiscovery);
  });

  test('falls back per ID to the global provider and restores the module default after exit', async () => {
    const globalShared = buildProvider('shared');
    const globalOther = buildProvider('global-only');
    registerProvider(globalShared);
    registerProvider(globalOther);
    const scopedShared = buildProvider('shared');
    const scopedToolSource = buildDiscovery('scoped', ['scoped-tool']);

    await withProviderOverrides(new Map([['shared', scopedShared]]), async () => {
      expect(getProvider('shared')).toBe(scopedShared);
      expect(getProvider('global-only')).toBe(globalOther);
      const combined = getConnectableProviders();
      expect(combined.some((provider) => provider === scopedShared)).toBe(true);
      expect(combined.some((provider) => provider === globalOther)).toBe(true);
      expect(combined.some((provider) => provider === globalShared)).toBe(false);
      await withWorkspaceToolDiscovery(scopedToolSource, async () => {
        expect(getWorkspaceToolDiscovery()).toBe(scopedToolSource);
        expect(Object.keys(await discoverWorkspaceTools('/any'))).toEqual(['scoped-tool']);
      });
    });

    expect(getProvider('shared')).toBe(globalShared);
    expect(getWorkspaceToolDiscovery()).not.toBe(scopedToolSource);
  });
});
