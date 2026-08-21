import { create } from 'zustand';
import type {
  Workspace,
  Preconfig,
  PromptInfo,
  ModelWithStatus,
  ProviderStatus,
  Agent,
} from '@prokopai/sdk';

interface ServerDataState {
  serverId: string | null;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  preconfigs: Preconfig[];
  prompts: PromptInfo[];
  models: ModelWithStatus[];
  defaultModel: string;
  defaultProvider: string;
  providers: ProviderStatus[];
  agents: Agent[];
}

interface ServerDataActions {
  hydrate: (serverId: string, data: {
    workspaces: Workspace[];
    preconfigs: Preconfig[];
    prompts: PromptInfo[];
    models: ModelWithStatus[];
    defaultModel: string;
    defaultProvider: string;
    providers: ProviderStatus[];
    agents: Agent[];
  }) => void;
  hydrateCritical: (serverId: string, data: {
    workspaces: Workspace[];
    preconfigs: Preconfig[];
    models: ModelWithStatus[];
    defaultModel: string;
    defaultProvider: string;
  }) => void;
  hydrateSecondary: (data: {
    prompts: PromptInfo[];
    providers: ProviderStatus[];
    agents: Agent[];
  }) => void;
  updateModels: (models: ModelWithStatus[], defaultModel: string, defaultProvider: string) => void;
  updatePreconfigs: (preconfigs: Preconfig[]) => void;
  updatePrompts: (prompts: PromptInfo[]) => void;
  updateProviders: (providers: ProviderStatus[]) => void;
  updateAgents: (agents: Agent[]) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  setActiveWorkspace: (workspace: Workspace | null) => void;
  clearAll: () => void;
}

export const useServerDataStore = create<ServerDataState & ServerDataActions>((set) => ({
  serverId: null,
  workspaces: [],
  activeWorkspace: null,
  preconfigs: [],
  prompts: [],
  models: [],
  defaultModel: 'gpt-4o',
  defaultProvider: 'openai',
  providers: [],
  agents: [],

  hydrate: (serverId, data) => set({
    serverId,
    ...data,
  }),

  hydrateCritical: (serverId, data) => set({
    serverId,
    workspaces: data.workspaces,
    preconfigs: data.preconfigs,
    models: data.models,
    defaultModel: data.defaultModel,
    defaultProvider: data.defaultProvider,
  }),

  hydrateSecondary: (data) => set({
    prompts: data.prompts,
    providers: data.providers,
    agents: data.agents,
  }),

  updateModels: (models, defaultModel, defaultProvider) => set({
    models,
    defaultModel,
    defaultProvider,
  }),

  updatePreconfigs: (preconfigs) => set({ preconfigs }),
  updatePrompts: (prompts) => set({ prompts }),
  updateProviders: (providers) => set({ providers }),
  updateAgents: (agents) => set({ agents }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),

  clearAll: () => set({
    serverId: null,
    workspaces: [],
    activeWorkspace: null,
    preconfigs: [],
    prompts: [],
    models: [],
    defaultModel: 'gpt-4o',
    defaultProvider: 'openai',
    providers: [],
    agents: [],
  }),
}));
