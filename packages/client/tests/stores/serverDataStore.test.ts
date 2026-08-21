import { describe, test, expect, beforeEach } from 'vitest';
import { useServerDataStore } from '@/stores/serverDataStore';
import type { Workspace, ModelWithStatus, ProviderStatus } from '@prokopai/sdk';

const mockWorkspace: Workspace = {
  id: 'ws-1',
  name: 'Test Workspace',
  path: '/test/path',
  createdAt: new Date().toISOString(),
} as Workspace;

const mockModel: ModelWithStatus = {
  id: 'model-1',
  name: 'GPT-4o',
  contextWindow: 128000,
  tier: 'standard',
  providerId: 'openai',
  providerName: 'OpenAI',
  runtimeStatus: { providerSupported: true, providerConfigured: true, usable: true },
};

const mockProvider: ProviderStatus = {
  provider: 'openai',
  connected: true,
};

describe('serverDataStore', () => {
  beforeEach(() => {
    useServerDataStore.getState().clearAll();
  });

  describe('initial state', () => {
    test('starts with null serverId', () => {
      expect(useServerDataStore.getState().serverId).toBeNull();
    });

    test('starts with empty workspaces', () => {
      expect(useServerDataStore.getState().workspaces).toEqual([]);
    });

    test('starts with null activeWorkspace', () => {
      expect(useServerDataStore.getState().activeWorkspace).toBeNull();
    });

    test('starts with default model', () => {
      expect(useServerDataStore.getState().defaultModel).toBe('gpt-4o');
    });

    test('starts with default provider', () => {
      expect(useServerDataStore.getState().defaultProvider).toBe('openai');
    });
  });

  describe('hydrate', () => {
    test('sets serverId and all data', () => {
      useServerDataStore.getState().hydrate('server-1', {
        workspaces: [mockWorkspace],
        preconfigs: [],
        prompts: [],
        models: [mockModel],
        defaultModel: 'claude-3',
        defaultProvider: 'anthropic',
        providers: [mockProvider],
        agents: [],
      });

      const state = useServerDataStore.getState();
      expect(state.serverId).toBe('server-1');
      expect(state.workspaces).toEqual([mockWorkspace]);
      expect(state.models).toEqual([mockModel]);
      expect(state.defaultModel).toBe('claude-3');
      expect(state.defaultProvider).toBe('anthropic');
    });
  });

  describe('updateModels', () => {
    test('updates models and defaults', () => {
      const newModel: ModelWithStatus = { ...mockModel, id: 'model-2', name: 'Claude 3' };
      useServerDataStore.getState().updateModels([newModel], 'claude-3', 'anthropic');
      const state = useServerDataStore.getState();
      expect(state.models).toEqual([newModel]);
      expect(state.defaultModel).toBe('claude-3');
    });
  });

  describe('updatePreconfigs', () => {
    test('updates preconfigs array', () => {
      const preconfigs = [{ id: 'pc-1', name: 'Default' }];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useServerDataStore.getState().updatePreconfigs(preconfigs as any);
      expect(useServerDataStore.getState().preconfigs).toEqual(preconfigs);
    });
  });

  describe('updatePrompts', () => {
    test('updates prompts array', () => {
      const prompts = [{ id: 'prompt-1', name: 'System Prompt' }];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useServerDataStore.getState().updatePrompts(prompts as any);
      expect(useServerDataStore.getState().prompts).toEqual(prompts);
    });
  });

  describe('updateProviders', () => {
    test('updates providers array', () => {
      useServerDataStore.getState().updateProviders([mockProvider]);
      expect(useServerDataStore.getState().providers).toEqual([mockProvider]);
    });
  });

  describe('setWorkspaces', () => {
    test('sets workspaces array', () => {
      useServerDataStore.getState().setWorkspaces([mockWorkspace]);
      expect(useServerDataStore.getState().workspaces).toEqual([mockWorkspace]);
    });
  });

  describe('setActiveWorkspace', () => {
    test('sets active workspace', () => {
      useServerDataStore.getState().setActiveWorkspace(mockWorkspace);
      expect(useServerDataStore.getState().activeWorkspace).toEqual(mockWorkspace);
    });

    test('clears active workspace with null', () => {
      useServerDataStore.getState().setActiveWorkspace(mockWorkspace);
      useServerDataStore.getState().setActiveWorkspace(null);
      expect(useServerDataStore.getState().activeWorkspace).toBeNull();
    });
  });

  describe('clearAll', () => {
    test('resets everything to defaults', () => {
      useServerDataStore.getState().hydrate('server-1', {
        workspaces: [mockWorkspace],
        preconfigs: [],
        prompts: [],
        models: [mockModel],
        defaultModel: 'claude',
        defaultProvider: 'anthropic',
        providers: [mockProvider],
        agents: [],
      });
      useServerDataStore.getState().setActiveWorkspace(mockWorkspace);

      useServerDataStore.getState().clearAll();

      const state = useServerDataStore.getState();
      expect(state.serverId).toBeNull();
      expect(state.workspaces).toEqual([]);
      expect(state.activeWorkspace).toBeNull();
      expect(state.preconfigs).toEqual([]);
      expect(state.prompts).toEqual([]);
      expect(state.models).toEqual([]);
      expect(state.defaultModel).toBe('gpt-4o');
      expect(state.defaultProvider).toBe('openai');
      expect(state.providers).toEqual([]);
    });
  });
});
