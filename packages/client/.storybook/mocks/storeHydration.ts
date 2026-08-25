// =============================================================================
// Store Hydration — Helpers to populate Zustand stores for Storybook stories
// =============================================================================
//
// Two APIs available:
//   1. hydrateStores(options) / clearStores() — imperative approach for beforeEach/decorators
//   2. withXStore(overrides) decorators — declarative approach for story `decorators` arrays
//
// Both are valid. Decorators are preferred for new stories.

import { useSessionStore } from '@/stores/sessionStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useConnectionStore } from '@/stores/connectionStore';
import type { MessageWithParts } from '@prokopai/sdk';
import {
  createWorkspace,
  createSession,
  createModelList,
  createProviderList,
  createPreconfigList,
} from './index';
import { resetAllStores } from './storeCleanup';

interface HydrateStoresOptions {
  /** Whether to include a connected session (default: true) */
  connected?: boolean;
  /** Whether to populate with sample data (default: true) */
  withSampleData?: boolean;
  /** Messages to load into the current session */
  messages?: MessageWithParts[];
}

/**
 * Hydrate all stores with mock data for Storybook stories.
 * Call this in a story's `beforeEach` or in a decorator.
 */
export function hydrateStores(options: HydrateStoresOptions = {}): void {
  const {
    connected = true,
    withSampleData = true,
    messages,
  } = options;

  // Reset first to ensure clean state
  resetAllStores();

  // --- Connection Store ---
  const connectionStore = useConnectionStore.getState();
  connectionStore.setConnected(connected);

  if (!withSampleData) return;

  // --- Server Data Store ---
  const workspace = createWorkspace({ name: 'my-project', path: '/home/user/my-project' });
  const session = createSession({
    title: 'Storybook Session',
    workspaceId: workspace.id,
  });

  const serverDataStore = useServerDataStore.getState();
  serverDataStore.hydrate('mock-server-id', {
    workspaces: [workspace],
    preconfigs: createPreconfigList(),
    prompts: [],
    models: createModelList(),
    defaultModel: 'claude-3.5-sonnet',
    defaultProvider: 'anthropic',
    providers: createProviderList(),
    agents: [],
  });
  serverDataStore.setActiveWorkspace(workspace);

  // --- Session Store ---
  const sessionStore = useSessionStore.getState();
  sessionStore.setCurrentSession(session);
  sessionStore.setSessions([session]);

  if (messages && messages.length > 0) {
    const sessionId = session.id;
    const msgArray = messages.map((mwp) => mwp.message);
    const partsMap: Record<string, Record<string, typeof messages[number]['parts']>> = {};
    for (const mwp of messages) {
      if (!partsMap[sessionId]) partsMap[sessionId] = {};
      partsMap[sessionId][mwp.message.id] = mwp.parts;
    }
    sessionStore.setMessagesBySession({ [sessionId]: msgArray });
    sessionStore.setPartsBySession(partsMap);
  }
}

/**
 * Clear all stores — delegates to resetAllStores().
 * Useful in story `afterEach` or between stories.
 */
export function clearStores(): void {
  resetAllStores();
}
