// =============================================================================
// Store Decorators — Decorator-based Zustand store overrides for Storybook
// =============================================================================
//
// Usage in stories:
//   decorators: [withSessionStore({ currentModel: 'gpt-4o' })]
//   decorators: [withAllStores()]
//   decorators: [withAllStores({ connection: { connected: false } })]

import type { ComponentType } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import type { SessionUsage } from '@/stores/sessionStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useUIStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useDockStore } from '@/stores/dockStore';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useAskStore } from '@/stores/askStore';
import type { PendingAskRequest, AskHandler } from '@/stores/askStore';
import { useCompletionStore } from '@/stores/completionStore';
import type { CompletionRecord } from '@/stores/completionStore';
import {
  createWorkspace,
  createSession,
  createModelList,
  createProviderList,
  createPreconfigList,
} from './index';

// -----------------------------------------------------------------------------
// Type aliases for store state (state fields only, no actions)
// -----------------------------------------------------------------------------

type SessionStoreState = ReturnType<typeof useSessionStore.getState>;
type ServerDataStoreState = ReturnType<typeof useServerDataStore.getState>;
type UIStoreState = ReturnType<typeof useUIStore.getState>;
type ConnectionStoreState = ReturnType<typeof useConnectionStore.getState>;
type ChatLayoutStoreState = ReturnType<typeof useChatLayoutStore.getState>;
type CompletionStoreState = ReturnType<typeof useCompletionStore.getState>;

// -----------------------------------------------------------------------------
// Session Store
// -----------------------------------------------------------------------------

interface SessionStoreDefaults {
  currentSession?: SessionStoreState['currentSession'];
  sessions?: SessionStoreState['sessions'];
  sessionUsage?: SessionUsage;
  currentModel?: string;
  selectedVariant?: string | null;
  compactionSuccess?: boolean;
  messagesBySession?: SessionStoreState['messagesBySession'];
  partsBySession?: SessionStoreState['partsBySession'];
  queuedMessages?: SessionStoreState['queuedMessages'];
}

const defaultSessionState = (): SessionStoreDefaults => {
  const workspace = createWorkspace({ name: 'my-project', path: '/home/user/my-project' });
  const session = createSession({ title: 'Storybook Session', workspaceId: workspace.id });
  return {
    currentSession: session,
    sessions: [session],
    sessionUsage: {
      promptTokens: 500,
      completionTokens: 200,
      totalTokens: 700,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      noCacheTokens: 0,
    },
    currentModel: 'claude-3.5-sonnet',
    selectedVariant: null,
    compactionSuccess: false,
    messagesBySession: {},
    partsBySession: {},
    queuedMessages: {},
  };
};

export function withSessionStore(overrides: SessionStoreDefaults = {}) {
  return function SessionStoreDecorator(Story: ComponentType) {
    useSessionStore.setState({ ...defaultSessionState(), ...overrides });
    return <Story />;
  };
}

// -----------------------------------------------------------------------------
// Server Data Store
// -----------------------------------------------------------------------------

interface ServerDataStoreDefaults {
  serverId?: string | null;
  workspaces?: ServerDataStoreState['workspaces'];
  activeWorkspace?: ServerDataStoreState['activeWorkspace'];
  preconfigs?: ServerDataStoreState['preconfigs'];
  prompts?: ServerDataStoreState['prompts'];
  models?: ServerDataStoreState['models'];
  defaultModel?: string;
  defaultProvider?: string;
  providers?: ServerDataStoreState['providers'];
}

const defaultServerDataState = (): ServerDataStoreDefaults => {
  const workspace = createWorkspace({ name: 'my-project', path: '/home/user/my-project' });
  return {
    serverId: 'mock-server-id',
    workspaces: [workspace],
    activeWorkspace: workspace,
    preconfigs: createPreconfigList(),
    prompts: [],
    models: createModelList(),
    defaultModel: 'claude-3.5-sonnet',
    defaultProvider: 'anthropic',
    providers: createProviderList(),
  };
};

export function withServerDataStore(overrides: ServerDataStoreDefaults = {}) {
  return function ServerDataStoreDecorator(Story: ComponentType) {
    useServerDataStore.setState({ ...defaultServerDataState(), ...overrides });
    return <Story />;
  };
}

// -----------------------------------------------------------------------------
// UI Store
// -----------------------------------------------------------------------------

interface UIStoreDefaults {
  showSettings?: boolean;
  showConfiguration?: boolean;
  showTools?: boolean;
  showMCPDialog?: boolean;
  showWorkspacePermissions?: boolean;
  chatFinishSoundEnabled?: boolean;
  permissionSoundEnabled?: boolean;
  filePreviewTarget?: UIStoreState['filePreviewTarget'];
}

const defaultUIState = (): UIStoreDefaults => ({
  showSettings: false,
  showConfiguration: false,
  showTools: false,
  showMCPDialog: false,
  showWorkspacePermissions: false,
  chatFinishSoundEnabled: true,
  permissionSoundEnabled: true,
  filePreviewTarget: null,
});

export function withUIStore(overrides: UIStoreDefaults = {}) {
  return function UIStoreDecorator(Story: ComponentType) {
    useUIStore.setState({ ...defaultUIState(), ...overrides });
    return <Story />;
  };
}

// -----------------------------------------------------------------------------
// Connection Store
// -----------------------------------------------------------------------------

interface ConnectionStoreDefaults {
  connected?: ConnectionStoreState['connected'];
  authError?: string | null;
  connectionTimedOut?: boolean;
  retryCount?: number;
  nextRetryIn?: number;
  streamingSessionIds?: Set<string>;
  interruptedSessions?: Set<string>;
}

const defaultConnectionState = (): ConnectionStoreDefaults => ({
  connected: true,
  authError: null,
  connectionTimedOut: false,
  retryCount: 0,
  nextRetryIn: 0,
  streamingSessionIds: new Set<string>(),
  interruptedSessions: new Set<string>(),
});

export function withConnectionStore(overrides: ConnectionStoreDefaults = {}) {
  return function ConnectionStoreDecorator(Story: ComponentType) {
    useConnectionStore.setState({ ...defaultConnectionState(), ...overrides });
    return <Story />;
  };
}

// -----------------------------------------------------------------------------
// Chat Layout Store
// -----------------------------------------------------------------------------

interface ChatLayoutStoreDefaults {
  mobileSurface?: ChatLayoutStoreState['mobileSurface'];
  workbenchSurface?: ChatLayoutStoreState['workbenchSurface'];
  filesPanelTab?: ChatLayoutStoreState['filesPanelTab'];
}

const defaultChatLayoutState = (): ChatLayoutStoreDefaults => ({
  mobileSurface: 'chat',
  workbenchSurface: 'explorer',
  filesPanelTab: 'project',
});

export function withChatLayoutStore(overrides: ChatLayoutStoreDefaults = {}) {
  return function ChatLayoutStoreDecorator(Story: ComponentType) {
    useChatLayoutStore.setState({ ...defaultChatLayoutState(), ...overrides });
    return <Story />;
  };
}

// -----------------------------------------------------------------------------
// Ask Store
// -----------------------------------------------------------------------------

interface AskStoreDefaults {
  pendingRequests?: PendingAskRequest[];
  handlers?: Map<string, AskHandler[]>;
}

const defaultAskState = (): AskStoreDefaults => ({
  pendingRequests: [],
  handlers: new Map(),
});

export function withAskStore(overrides: AskStoreDefaults = {}) {
  return function AskStoreDecorator(Story: ComponentType) {
    useAskStore.setState({ ...defaultAskState(), ...overrides });
    return <Story />;
  };
}

// -----------------------------------------------------------------------------
// Completion Store
// -----------------------------------------------------------------------------

interface CompletionStoreDefaults {
  completionState?: CompletionStoreState['completionState'];
}

const defaultCompletionState = (): CompletionStoreDefaults => ({
  completionState: new Map<string, CompletionRecord>(),
});

export function withCompletionStore(overrides: CompletionStoreDefaults = {}) {
  return function CompletionStoreDecorator(Story: ComponentType) {
    useCompletionStore.setState({ ...defaultCompletionState(), ...overrides });
    return <Story />;
  };
}

// -----------------------------------------------------------------------------
// Convenience: All Stores Combined
// -----------------------------------------------------------------------------

export interface AllStoresOverrides {
  session?: SessionStoreDefaults;
  serverData?: ServerDataStoreDefaults;
  ui?: UIStoreDefaults;
  connection?: ConnectionStoreDefaults;
  chatLayout?: ChatLayoutStoreDefaults;
  docks?: ReturnType<typeof useDockStore.getState>['docks'];
  ask?: AskStoreDefaults;
  completion?: CompletionStoreDefaults;
}

export function withAllStores(overrides: AllStoresOverrides = {}) {
  return function AllStoresDecorator(Story: ComponentType) {
    // Set each store's state — order matters (server data before session)
    useServerDataStore.setState({ ...defaultServerDataState(), ...overrides.serverData });
    useSessionStore.setState({ ...defaultSessionState(), ...overrides.session });
    useUIStore.setState({ ...defaultUIState(), ...overrides.ui });
    useConnectionStore.setState({ ...defaultConnectionState(), ...overrides.connection });
    useChatLayoutStore.setState({ ...defaultChatLayoutState(), ...overrides.chatLayout });
    useDockStore.setState({ docks: overrides.docks ?? useDockStore.getInitialState().docks });
    useAskStore.setState({ ...defaultAskState(), ...overrides.ask });
    useCompletionStore.setState({ ...defaultCompletionState(), ...overrides.completion });
    return <Story />;
  };
}
