import { create } from 'zustand';
import type { Session, Message, Part, MessageWithParts, QueuedMessage } from '@prokopai/sdk';

// --- Session Usage ---
export type SessionUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  noCacheTokens: number;
};

const DEFAULT_USAGE: SessionUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  noCacheTokens: 0,
};

export type SessionNavigationIntent =
  | { mode: 'follow' }
  | { mode: 'free' }
  | { mode: 'target-message'; messageId: string };

export interface ResumeSessionOptions {
  targetMessageId?: string;
}

// --- Session Content Lifecycle ---
export type SessionContentStatus = 'unloaded' | 'loading' | 'ready' | 'error';

export interface SessionContentMeta {
  status: SessionContentStatus;
  error: string | null;
  loadedAt: number | null;
  lastAccessedAt: number | null;
  hasOlder: boolean;
  oldestSequence: number | null;
  newestSequence: number | null;
  isLoadingOlder: boolean;
  loadOlderError: string | null;
}

const DEFAULT_CONTENT_META: SessionContentMeta = {
  status: 'unloaded',
  error: null,
  loadedAt: null,
  lastAccessedAt: null,
  hasOlder: false,
  oldestSequence: null,
  newestSequence: null,
  isLoadingOlder: false,
  loadOlderError: null,
};

export type ContentMetaBySession = Record<string, SessionContentMeta>;

// --- Weighted cache constants ---
const MESSAGE_WEIGHT = 100;
const PART_WEIGHT = 50;
const SESSION_CONTENT_BUDGET = 2_000_000;

export function estimateContentWeight(
  messages: Message[],
  partsByMessage: Record<string, Part[]>,
): number {
  let textChars = 0;
  for (const parts of Object.values(partsByMessage)) {
    for (const part of parts) {
      if (part.type === 'text' || part.type === 'reasoning') {
        textChars += part.text?.length ?? 0;
      }
    }
  }
  return (
    messages.length * MESSAGE_WEIGHT +
    Object.values(partsByMessage).reduce((sum, p) => sum + p.length, 0) * PART_WEIGHT +
    textChars
  );
}

// --- Type Aliases ---
type SessionsUpdater = Session[] | ((prev: Session[]) => Session[]);
type MessagesBySessionState = Record<string, Message[]>;
type PartsBySessionState = Record<string, Record<string, Part[]>>;
type MessagesBySessionUpdater = MessagesBySessionState | ((prev: MessagesBySessionState) => MessagesBySessionState);
type PartsBySessionUpdater = PartsBySessionState | ((prev: PartsBySessionState) => PartsBySessionState);
type ContentMetaUpdater = ContentMetaBySession | ((prev: ContentMetaBySession) => ContentMetaBySession);

// --- Combined Store ---
interface SessionState {
  // --- Active Session ---
  currentSession: Session | null;

  // --- Session List ---
  sessions: Session[];

  // --- Chat Session (singleton, backward compat) ---
  sessionUsage: SessionUsage;
  currentModel: string;
  selectedVariant: string | null;
  compactionSuccess: boolean;

  // --- Per-session keyed state (multi-pane) ---
  usageBySessionId: Record<string, SessionUsage>;
  modelBySessionId: Record<string, string>;
  variantBySessionId: Record<string, string | null>;
  compactionSuccessBySessionId: Record<string, boolean>;
  navigationIntentBySessionId: Record<string, SessionNavigationIntent>;

  // --- Session Content ---
  messagesBySession: MessagesBySessionState;
  partsBySession: PartsBySessionState;
  contentMetaBySession: ContentMetaBySession;

  // --- Message Queue ---
  queuedMessages: Record<string, QueuedMessage[]>;

  // --- Navigation (singleton, backward compat) ---
  navigationIntent: SessionNavigationIntent;
}

interface SessionActions {
  // --- Active Session ---
  setCurrentSession: (session: Session | null) => void;
  clearActiveSession: () => void;

  // --- Session List ---
  setSessions: (updater: SessionsUpdater) => void;
  addSessionToFront: (session: Session) => void;
  mergeSessions: (sessions: Session[]) => void;
  replaceSessionsForWorkspace: (workspaceId: string, sessions: Session[]) => void;
  removeSessionsForWorkspace: (workspaceId: string) => void;
  updateSession: (session: Session) => void;
  removeSessionById: (sessionId: string) => void;
  clearSessions: () => void;

  // --- Chat Session (singleton, backward compat) ---
  setSessionUsage: (usage: SessionUsage) => void;
  setCurrentModel: (model: string) => void;
  setSelectedVariant: (variant: string | null) => void;
  setCompactionSuccess: (success: boolean) => void;
  clearChatSession: () => void;

  // --- Per-session keyed state (multi-pane) ---
  setUsageForSession: (sessionId: string, usage: SessionUsage) => void;
  setModelForSession: (sessionId: string, model: string) => void;
  setVariantForSession: (sessionId: string, variant: string | null) => void;
  setCompactionSuccessForSession: (sessionId: string, success: boolean) => void;
  setNavigationIntentForSession: (sessionId: string, intent: SessionNavigationIntent) => void;
  getUsageForSession: (sessionId: string) => SessionUsage;
  getModelForSession: (sessionId: string) => string;
  getVariantForSession: (sessionId: string) => string | null;
  getCompactionSuccessForSession: (sessionId: string) => boolean;
  getNavigationIntentForSession: (sessionId: string) => SessionNavigationIntent;
  clearSessionKeyedState: (sessionId: string) => void;

  // --- Session Content ---
  setMessagesBySession: (updater: MessagesBySessionUpdater) => void;
  setPartsBySession: (updater: PartsBySessionUpdater) => void;
  setContentMetaBySession: (updater: ContentMetaUpdater) => void;
  getMessagesBySessionKeysCount: () => number;

  // --- Atomic Content Lifecycle Actions ---
  beginSessionContentLoad: (sessionId: string) => void;
  replaceSessionContent: (
    sessionId: string,
    messagesWithParts: MessageWithParts[],
    metadata?: Partial<Pick<SessionContentMeta, 'hasOlder' | 'oldestSequence' | 'newestSequence'>>,
  ) => void;
  prependSessionContent: (
    sessionId: string,
    messagesWithParts: MessageWithParts[],
    metadata?: Partial<Pick<SessionContentMeta, 'hasOlder' | 'oldestSequence'>>,
  ) => void;
  failSessionContentLoad: (sessionId: string, error: string) => void;
  touchSessionContent: (sessionId: string) => void;
  evictSessionContent: (sessionId: string) => void;

  /**
   * Remove transcript content for multiple sessions in a single store update.
   * Used by workspace deletion to avoid N separate notifications.
   */
  evictSessionContentBatch: (sessionIds: string[]) => void;

  // --- Older-page pagination actions ---
  beginOlderContentLoad: (sessionId: string) => void;
  prependSessionContentPage: (
    sessionId: string,
    messagesWithParts: MessageWithParts[],
    metadata: Pick<SessionContentMeta, 'hasOlder' | 'oldestSequence'>,
  ) => void;
  failOlderContentLoad: (sessionId: string, error: string) => void;

  // --- Message Queue ---
  clearQueuedMessages: () => void;
  setQueuedMessagesForSession: (sessionId: string, messages: QueuedMessage[]) => void;
  addQueuedMessage: (sessionId: string, message: QueuedMessage) => void;
  removeQueuedMessageById: (sessionId: string, queueId: string) => void;
  removeQueuedMessagesByIds: (sessionId: string, queueIds: string[]) => void;

  // --- Navigation ---
  setNavigationIntent: (intent: SessionNavigationIntent) => void;
  clearTargetMessageIntent: () => void;
}

type SessionStore = SessionState & SessionActions;

export const useSessionStore = create<SessionStore>((set, get) => ({
  // --- Active Session ---
  currentSession: null,

  setCurrentSession: (session) => set({ currentSession: session }),
  clearActiveSession: () => set({ currentSession: null }),

  // --- Session List ---
  sessions: [],

  setSessions: (updater) =>
    set((state) => ({
      sessions: typeof updater === 'function' ? updater(state.sessions) : updater,
    })),

  addSessionToFront: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions.filter((s) => s.id !== session.id)],
    })),

  mergeSessions: (incoming) =>
    set((state) => {
      const existing = new Map(state.sessions.map((s) => [s.id, s]));
      for (const session of incoming) {
        existing.set(session.id, session);
      }
      return { sessions: [...existing.values()] };
    }),

  replaceSessionsForWorkspace: (workspaceId, sessions) =>
    set((state) => ({
      sessions: [
        ...state.sessions.filter((s) => s.workspaceId !== workspaceId),
        ...sessions,
      ],
    })),

  removeSessionsForWorkspace: (workspaceId) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.workspaceId !== workspaceId),
    })),

  updateSession: (session) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === session.id ? session : s)),
    })),

  removeSessionById: (sessionId) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== sessionId),
    })),

  clearSessions: () => set({ sessions: [] }),

  // --- Chat Session (singleton, backward compat) ---
  sessionUsage: { ...DEFAULT_USAGE },
  currentModel: 'gpt-4o',
  selectedVariant: null,
  compactionSuccess: false,

  setSessionUsage: (sessionUsage) => set({ sessionUsage }),
  setCurrentModel: (currentModel) => set({ currentModel }),
  setSelectedVariant: (selectedVariant) => set({ selectedVariant }),
  setCompactionSuccess: (compactionSuccess) => set({ compactionSuccess }),
  clearChatSession: () =>
    set({
      sessionUsage: { ...DEFAULT_USAGE },
      currentModel: 'gpt-4o',
      selectedVariant: null,
      compactionSuccess: false,
    }),

  // --- Per-session keyed state (multi-pane) ---
  usageBySessionId: {},
  modelBySessionId: {},
  variantBySessionId: {},
  compactionSuccessBySessionId: {},
  navigationIntentBySessionId: {},

  setUsageForSession: (sessionId, usage) =>
    set((state) => ({
      usageBySessionId: { ...state.usageBySessionId, [sessionId]: usage },
    })),

  setModelForSession: (sessionId, model) =>
    set((state) => ({
      modelBySessionId: { ...state.modelBySessionId, [sessionId]: model },
    })),

  setVariantForSession: (sessionId, variant) =>
    set((state) => ({
      variantBySessionId: { ...state.variantBySessionId, [sessionId]: variant },
    })),

  setCompactionSuccessForSession: (sessionId, success) =>
    set((state) => ({
      compactionSuccessBySessionId: { ...state.compactionSuccessBySessionId, [sessionId]: success },
    })),

  setNavigationIntentForSession: (sessionId, intent) =>
    set((state) => ({
      navigationIntentBySessionId: { ...state.navigationIntentBySessionId, [sessionId]: intent },
    })),

  getUsageForSession: (sessionId) => get().usageBySessionId[sessionId] ?? DEFAULT_USAGE,

  getModelForSession: (sessionId) => get().modelBySessionId[sessionId] ?? get().currentModel,

  getVariantForSession: (sessionId) => get().variantBySessionId[sessionId] ?? get().selectedVariant,

  getCompactionSuccessForSession: (sessionId) => get().compactionSuccessBySessionId[sessionId] ?? false,

  getNavigationIntentForSession: (sessionId) => get().navigationIntentBySessionId[sessionId] ?? { mode: 'follow' },

  clearSessionKeyedState: (sessionId) =>
    set((state) => {
      const newUsage = { ...state.usageBySessionId };
      const newModel = { ...state.modelBySessionId };
      const newVariant = { ...state.variantBySessionId };
      const newCompaction = { ...state.compactionSuccessBySessionId };
      const newNav = { ...state.navigationIntentBySessionId };
      delete newUsage[sessionId];
      delete newModel[sessionId];
      delete newVariant[sessionId];
      delete newCompaction[sessionId];
      delete newNav[sessionId];
      return {
        usageBySessionId: newUsage,
        modelBySessionId: newModel,
        variantBySessionId: newVariant,
        compactionSuccessBySessionId: newCompaction,
        navigationIntentBySessionId: newNav,
      };
    }),

  // --- Session Content ---
  messagesBySession: {},
  partsBySession: {},
  contentMetaBySession: {},

  setMessagesBySession: (updater) =>
    set((state) => ({
      messagesBySession:
        typeof updater === 'function'
          ? updater(state.messagesBySession)
          : updater,
    })),

  setPartsBySession: (updater) =>
    set((state) => ({
      partsBySession:
        typeof updater === 'function' ? updater(state.partsBySession) : updater,
    })),

  setContentMetaBySession: (updater) =>
    set((state) => ({
      contentMetaBySession:
        typeof updater === 'function'
          ? updater(state.contentMetaBySession)
          : updater,
    })),

  getMessagesBySessionKeysCount: () => Object.keys(get().messagesBySession).length,

  // --- Atomic Content Lifecycle Actions ---
  beginSessionContentLoad: (sessionId) =>
    set((state) => ({
      contentMetaBySession: {
        ...state.contentMetaBySession,
        [sessionId]: {
          ...DEFAULT_CONTENT_META,
          ...(state.contentMetaBySession[sessionId] ?? {}),
          status: 'loading',
          error: null,
        },
      },
    })),

  replaceSessionContent: (sessionId, messagesWithParts, metadata) => {
    const messages = messagesWithParts.map((mwp) => mwp.message);
    const parts: Record<string, Part[]> = {};
    for (const mwp of messagesWithParts) {
      parts[mwp.message.id] = mwp.parts;
    }
    const now = Date.now();
    set((state) => ({
      messagesBySession: { ...state.messagesBySession, [sessionId]: messages },
      partsBySession: { ...state.partsBySession, [sessionId]: parts },
      contentMetaBySession: {
        ...state.contentMetaBySession,
        [sessionId]: {
          status: 'ready',
          error: null,
          loadedAt: now,
          lastAccessedAt: now,
          hasOlder: metadata?.hasOlder ?? false,
          oldestSequence: metadata?.oldestSequence ?? null,
          newestSequence: metadata?.newestSequence ?? null,
          isLoadingOlder: false,
          loadOlderError: null,
        },
      },
    }));
  },

  prependSessionContent: (sessionId, messagesWithParts, metadata) =>
    set((state) => {
      const existingMessages = state.messagesBySession[sessionId] ?? [];
      const existingParts = state.partsBySession[sessionId] ?? {};
      const prependMessages = messagesWithParts.map((mwp) => mwp.message);
      const prependParts: Record<string, Part[]> = {};
      for (const mwp of messagesWithParts) {
        prependParts[mwp.message.id] = mwp.parts;
      }
      const currentMeta = state.contentMetaBySession[sessionId] ?? DEFAULT_CONTENT_META;
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: [...prependMessages, ...existingMessages],
        },
        partsBySession: {
          ...state.partsBySession,
          [sessionId]: { ...prependParts, ...existingParts },
        },
        contentMetaBySession: {
          ...state.contentMetaBySession,
          [sessionId]: {
            ...currentMeta,
            hasOlder: metadata?.hasOlder ?? currentMeta.hasOlder,
            oldestSequence: metadata?.oldestSequence ?? currentMeta.oldestSequence,
          },
        },
      };
    }),

  failSessionContentLoad: (sessionId, error) =>
    set((state) => ({
      contentMetaBySession: {
        ...state.contentMetaBySession,
        [sessionId]: {
          ...(state.contentMetaBySession[sessionId] ?? DEFAULT_CONTENT_META),
          status: 'error',
          error,
        },
      },
    })),

  touchSessionContent: (sessionId) =>
    set((state) => {
      const meta = state.contentMetaBySession[sessionId];
      if (!meta) return state;
      return {
        contentMetaBySession: {
          ...state.contentMetaBySession,
          [sessionId]: { ...meta, lastAccessedAt: Date.now() },
        },
      };
    }),

  evictSessionContent: (sessionId) =>
    set((state) => {
      const newMessages = { ...state.messagesBySession };
      const newParts = { ...state.partsBySession };
      const newMeta = { ...state.contentMetaBySession };
      delete newMessages[sessionId];
      delete newParts[sessionId];
      delete newMeta[sessionId];
      return {
        messagesBySession: newMessages,
        partsBySession: newParts,
        contentMetaBySession: newMeta,
      };
    }),

  evictSessionContentBatch: (sessionIds) =>
    set((state) => {
      if (sessionIds.length === 0) return state;
      const newMessages = { ...state.messagesBySession };
      const newParts = { ...state.partsBySession };
      const newMeta = { ...state.contentMetaBySession };
      for (const id of sessionIds) {
        delete newMessages[id];
        delete newParts[id];
        delete newMeta[id];
      }
      return {
        messagesBySession: newMessages,
        partsBySession: newParts,
        contentMetaBySession: newMeta,
      };
    }),

  // --- Older-page pagination actions ---
  beginOlderContentLoad: (sessionId) =>
    set((state) => {
      const meta = state.contentMetaBySession[sessionId];
      if (!meta) return state;
      return {
        contentMetaBySession: {
          ...state.contentMetaBySession,
          [sessionId]: { ...meta, isLoadingOlder: true, loadOlderError: null },
        },
      };
    }),

  prependSessionContentPage: (sessionId, pageMessages, metadata) =>
    set((state) => {
      const existingMessages = state.messagesBySession[sessionId] ?? [];
      const existingParts = state.partsBySession[sessionId] ?? {};
      const existingIds = new Set(existingMessages.map((m) => m.id));
      const prependMessages = pageMessages
        .filter((mwp) => !existingIds.has(mwp.message.id))
        .map((mwp) => mwp.message);
      const prependParts: Record<string, Part[]> = {};
      for (const mwp of pageMessages) {
        if (!existingIds.has(mwp.message.id)) {
          prependParts[mwp.message.id] = mwp.parts;
        }
      }
      const currentMeta = state.contentMetaBySession[sessionId] ?? DEFAULT_CONTENT_META;
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: [...prependMessages, ...existingMessages],
        },
        partsBySession: {
          ...state.partsBySession,
          [sessionId]: { ...prependParts, ...existingParts },
        },
        contentMetaBySession: {
          ...state.contentMetaBySession,
          [sessionId]: {
            ...currentMeta,
            isLoadingOlder: false,
            loadOlderError: null,
            hasOlder: metadata.hasOlder,
            oldestSequence: metadata.oldestSequence ?? currentMeta.oldestSequence,
          },
        },
      };
    }),

  failOlderContentLoad: (sessionId, error) =>
    set((state) => {
      const meta = state.contentMetaBySession[sessionId];
      if (!meta) return state;
      return {
        contentMetaBySession: {
          ...state.contentMetaBySession,
          [sessionId]: { ...meta, isLoadingOlder: false, loadOlderError: error },
        },
      };
    }),

  // --- Message Queue ---
  queuedMessages: {},

  clearQueuedMessages: () => set({ queuedMessages: {} }),

  setQueuedMessagesForSession: (sessionId, messages) =>
    set((state) => ({
      queuedMessages: { ...state.queuedMessages, [sessionId]: messages },
    })),

  addQueuedMessage: (sessionId, message) =>
    set((state) => ({
      queuedMessages: {
        ...state.queuedMessages,
        [sessionId]: [...(state.queuedMessages[sessionId] || []), message],
      },
    })),

  removeQueuedMessageById: (sessionId, queueId) =>
    set((state) => ({
      queuedMessages: {
        ...state.queuedMessages,
        [sessionId]: (state.queuedMessages[sessionId] || []).filter((q) => q.id !== queueId),
      },
    })),

  removeQueuedMessagesByIds: (sessionId, queueIds) =>
    set((state) => ({
      queuedMessages: {
        ...state.queuedMessages,
        [sessionId]: (state.queuedMessages[sessionId] || []).filter((q) => !queueIds.includes(q.id)),
      },
    })),

  // --- Navigation ---
  navigationIntent: { mode: 'follow' },
  setNavigationIntent: (navigationIntent) => set({ navigationIntent }),
  clearTargetMessageIntent: () =>
    set((state) => ({
      navigationIntent:
        state.navigationIntent.mode === 'target-message'
          ? { mode: 'free' }
          : state.navigationIntent,
    })),
}));

// --- Utility Function ---
export function clearSessionState() {
  const state = useSessionStore.getState();
  state.clearSessions();
  state.clearActiveSession();
  state.clearChatSession();
  state.clearQueuedMessages();
  state.setMessagesBySession({});
  state.setPartsBySession({});
  state.setContentMetaBySession({});
  state.setNavigationIntent({ mode: 'follow' });
}

// --- Weighted cache eviction helper ---
/**
 * Evict cached session transcripts to stay within SESSION_CONTENT_BUDGET.
 * Never evicts the active session, sessions with loading/error status,
 * or sessions in the protectedSessionIds set (streaming, pending asks, etc.).
 * Returns the list of evicted session IDs so callers can clean up indexes.
 */
export function evictToBudget(
  activeSessionId: string | null,
  protectedSessionIds: Set<string>,
): string[] {
  const state = useSessionStore.getState();
  const { messagesBySession, partsBySession, contentMetaBySession } = state;

  const candidateIds = Object.keys(messagesBySession).filter((id) => {
    if (id === activeSessionId) return false;
    if (protectedSessionIds.has(id)) return false;
    const meta = contentMetaBySession[id];
    if (meta?.status === 'loading' || meta?.status === 'error') return false;
    return true;
  });

  const totalWeight = candidateIds.reduce((sum, id) => {
    const messages = messagesBySession[id] ?? [];
    const parts = partsBySession[id] ?? {};
    return sum + estimateContentWeight(messages, parts);
  }, 0);

  if (totalWeight <= SESSION_CONTENT_BUDGET) return [];

  const sorted = candidateIds.sort((a, b) => {
    const ta = contentMetaBySession[a]?.lastAccessedAt ?? 0;
    const tb = contentMetaBySession[b]?.lastAccessedAt ?? 0;
    return ta - tb;
  });

  const evicted: string[] = [];
  let remainingWeight = totalWeight;
  for (const id of sorted) {
    if (remainingWeight <= SESSION_CONTENT_BUDGET) break;
    const messages = messagesBySession[id] ?? [];
    const parts = partsBySession[id] ?? {};
    remainingWeight -= estimateContentWeight(messages, parts);
    evicted.push(id);
  }

  if (evicted.length > 0) {
    state.setMessagesBySession((prev) => {
      const next = { ...prev };
      for (const id of evicted) delete next[id];
      return next;
    });
    state.setPartsBySession((prev) => {
      const next = { ...prev };
      for (const id of evicted) delete next[id];
      return next;
    });
    state.setContentMetaBySession((prev) => {
      const next = { ...prev };
      for (const id of evicted) delete next[id];
      return next;
    });
  }

  return evicted;
}
