import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useParams, useRouterState } from '@tanstack/react-router';
import type {
  Session,
  Workspace,
  WorkspaceSettings,
  PermissionGrant,
  ProviderStatus,
  SavedServer,
  QuickConnection,
  QueuedMessage,
  Preconfig,
  PromptInfo,
  AttachmentKind,
  AskResponse,
} from '@prokopai/sdk';
import type { ProkopaiClient } from '@prokopai/sdk';
import type { SessionHandlersContext, ModelInfo } from '@/handlers/serverMessage/types';

import { useServerContext } from '@/contexts/ServerContext';
import { useSessionStore, type ResumeSessionOptions, type SessionUsage, evictToBudget } from '@/stores/sessionStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useAskStore, type PendingAskRequest } from '@/stores/askStore';
import { useCompletionStore } from '@/stores/completionStore';
import { useUIStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useOverviewGroupsStore } from '@/stores/overviewGroupsStore';

import { toast } from 'sonner';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';
import { useConnectionLifecycle } from '@/hooks/useConnectionLifecycle';
import { useSessionCommands } from '@/hooks/useSessionCommands';
import type { CreateSessionOptions } from '@/lib/sessionCreate';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { usePermissionAutoApprove } from '@/hooks/usePermissionAutoApprove';

export interface UseServerSessionManagerParams {
  serverId: string;
  activeServer: SavedServer | null;
  navigate: (opts: { to: string; params?: Record<string, string>; search?: Record<string, unknown> }) => void;
  removeFromQuickConnectionsByWorkspace: (workspaceId: string) => void;
  quickConnections: QuickConnection[];
}

export interface UseServerSessionManagerReturn {
  connected: boolean;
  authError: string | null;
  connectionTimedOut: boolean;
  retryCount: number;
  nextRetryIn: number;
  serverUrl: string | null;
  apiToken: string | null;

  sdkClient: ProkopaiClient | null;

  currentSession: Session | null;
  sessions: Session[];
  workspaceSessions: Session[];

  pendingAskRequests: PendingAskRequest[];
  queuedMessages: Record<string, QueuedMessage[]>;
  permissions: PermissionGrant[];

  sessionUsage: SessionUsage;
  currentModel: string;
  selectedVariant: string | null;
  isCompacting: boolean;
  compactionSuccess: boolean;
  isPrimarySession: boolean;
  isSessionLoading: boolean;

  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  preconfigs: Preconfig[];
  primaryPreconfigs: Preconfig[];
  prompts: PromptInfo[];
  models: ModelInfo[];
  defaultModel: string;

  streamingSessionIds: Set<string>;

  createSession: (preconfigId?: string, title?: string, options?: CreateSessionOptions) => void;
  resumeSession: (sessionId: string, options?: ResumeSessionOptions) => void;
  openAlongside: (sessionId: string) => void;
  closeSession: (sessionId: string) => void;
  reopenSession: (sessionId: string) => void;
  permanentlyDeleteSession: (sessionId: string) => void;
  handleRenameSession: (sessionId: string, title: string) => void;
  regenerateSessionTitle: (sessionId: string) => void;
  revertSession: (sessionId: string, messageId: string) => void;
  forkSession: (sessionId: string, messageId: string) => void;
  editMessage: (sessionId: string, messageId: string, content: string) => void;
  compactSession: (sessionId: string) => void;
  removeFromQueue: (queueId: string) => void;
  sendChatMessage: (content: string, attachments?: Array<{ id: string; kind: AttachmentKind }>, responseFormatId?: string, goal?: { condition: string; maxTurns?: number }) => void;
  sendChatMessageForSession: (sessionId: string, content: string, attachments?: Array<{ id: string; kind: AttachmentKind }>, responseFormatId?: string, goal?: { condition: string; maxTurns?: number }) => void;
  handleAskResponse: (toolCallId: string, response: AskResponse, requestId?: string) => void;
  handleInterruptSession: () => void;
  handleInterruptSessionById: (sessionId: string) => void;
  updateSessionPreconfig: (preconfigId: string) => void;
  updateSessionPreconfigForSession: (sessionId: string, preconfigId: string) => void;
  updateSessionModel: (modelId: string, providerId: string) => void;
  updateSessionModelForSession: (sessionId: string, modelId: string, providerId: string) => void;
  updateSessionVariant: (variant: string | null) => void;
  updateSessionVariantForSession: (sessionId: string, variant: string | null) => void;
  handleNavigateBack: () => void;
  refreshPermissions: () => void;
  createSessionInWorkspace: (workspaceId: string, options?: CreateSessionOptions) => void;
  revokePermission: (permissionId: string) => void;
  revokeAllPermissions: (workspaceId: string) => void;

  claimControl: (sessionId: string) => void;

  selectWorkspace: (workspace: Workspace) => void;
  renameWorkspace: (id: string, name: string) => void;
  updateWorkspacePaths: (id: string, additionalPaths: string[]) => void;
  updateWorkspaceSettings: (id: string, settings: WorkspaceSettings) => void;
  handleCreateVirtualWorkspace: () => void;
  handleCreatePhysicalWorkspace: (path: string) => void;
  deleteWorkspace: (id: string) => void;
  isCreatingWorkspace: boolean;
  deletingWorkspaceId: string | null;
  isUpdatingWorkspace: Record<string, boolean>;

  handleLogout: () => void;
  handleRetry: () => void;

  favoritedWorkspaceIds: string[];

  setCompactionSuccess: (success: boolean) => void;
}

export function useServerSessionManager({
  serverId: _serverId,
  activeServer,
  navigate,
  removeFromQuickConnectionsByWorkspace,
  quickConnections,
}: UseServerSessionManagerParams): UseServerSessionManagerReturn {
  const sdkClientRef = useRef<ProkopaiClient | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const sessionsRef = useRef<Session[]>([]);
  const sessionAccessTimesRef = useRef<Map<string, number>>(new Map());
  const prevSessionKeyCountRef = useRef(0);
  const notifiedToolCallIdsRef = useRef<Set<string>>(new Set());
  const partIdIndexRef = useRef<Map<string, { sessionId: string; messageId: string; index: number }>>(new Map());
  const pendingPartAppendsRef = useRef<Map<string, string>>(new Map());
  const partAppendRafRef = useRef<number | null>(null);
  const lastPartAppendFlushAtRef = useRef<number>(0);
  const partAppendTimeoutRef = useRef<number | null>(null);
  const skipFinishSoundSessionIdsRef = useRef<Set<string>>(new Set());
  const pendingSessionCreateRef = useRef<import('@/stores/sessionBoardStore').PendingSessionCreateIntent | null>(null);
  const handlerContextRef = useRef<SessionHandlersContext | null>(null);

  const { sessions, setSessions } = useSessionStore(
    useShallow((s) => ({
      sessions: s.sessions,
      setSessions: s.setSessions,
    })),
  );

  const { setCurrentSession } = useSessionStore(
    useShallow((s) => ({
      setCurrentSession: s.setCurrentSession,
    })),
  );

  const { setMessagesBySession, setPartsBySession } = useSessionStore(
    useShallow((state) => ({
      setMessagesBySession: state.setMessagesBySession,
      setPartsBySession: state.setPartsBySession,
    })),
  );

  // Derive currentSession from URL params
  const params = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
  const sessionIdFromUrl = params?.sessionId as string | undefined;
  const currentPathname = useRouterState({ select: (s) => s.location.pathname });
  const viewPath = currentPathname.includes('/overview') ? '/overview' : '/workspace';
  const currentSession = useMemo(
    () => sessionIdFromUrl ? sessions.find(s => s.id === sessionIdFromUrl) ?? null : null,
    [sessionIdFromUrl, sessions],
  );

  const isSessionLoading = sessionIdFromUrl != null && currentSession == null;

  // Focused-session adapter: synchronizes singleton compat state from the
  // focused session's keyed state. This is the ONLY place singleton values
  // (usage, model, variant, compaction, navigation intent) are derived from
  // per-session data. Server event handlers must not write singletons directly.
  const focusedSessionId = currentSession?.id ?? null;
  const focusedKeyedUsage = useSessionStore(s => focusedSessionId ? s.usageBySessionId[focusedSessionId] : undefined);
  const focusedKeyedModel = useSessionStore(s => focusedSessionId ? s.modelBySessionId[focusedSessionId] : undefined);
  const focusedKeyedVariant = useSessionStore(s => focusedSessionId ? s.variantBySessionId[focusedSessionId] : undefined);
  const focusedKeyedCompaction = useSessionStore(s => focusedSessionId ? s.compactionSuccessBySessionId[focusedSessionId] : undefined);
  const focusedKeyedNav = useSessionStore(s => focusedSessionId ? s.navigationIntentBySessionId[focusedSessionId] : undefined);
  useEffect(() => {
    const store = useSessionStore.getState();
    if (currentSession?.id !== store.currentSession?.id) {
      setCurrentSession(currentSession);
    }
    if (focusedSessionId) {
      if (focusedKeyedUsage && focusedKeyedUsage !== store.sessionUsage) {
        store.setSessionUsage(focusedKeyedUsage);
      }
      if (focusedKeyedModel && focusedKeyedModel !== store.currentModel) {
        store.setCurrentModel(focusedKeyedModel);
      }
      if (focusedKeyedVariant !== undefined && focusedKeyedVariant !== store.selectedVariant) {
        store.setSelectedVariant(focusedKeyedVariant);
      }
      if (focusedKeyedCompaction !== undefined && focusedKeyedCompaction !== store.compactionSuccess) {
        store.setCompactionSuccess(focusedKeyedCompaction);
      }
      if (focusedKeyedNav && focusedKeyedNav !== store.navigationIntent) {
        store.setNavigationIntent(focusedKeyedNav);
      }
    }
  }, [currentSession, focusedSessionId, focusedKeyedUsage, focusedKeyedModel, focusedKeyedVariant, focusedKeyedCompaction, focusedKeyedNav, setCurrentSession]);

  const activeSessionId = currentSession?.id;

  const {
    streamingSessionIds,
    interruptedSessions,
    addStreamingSession,
    removeStreamingSession,
    addInterruptedSession,
    removeInterruptedSession,
  } = useConnectionStore(
    useShallow((s) => ({
      streamingSessionIds: s.streamingSessionIds,
      interruptedSessions: s.interruptedSessions,
      addStreamingSession: s.addStreamingSession,
      removeStreamingSession: s.removeStreamingSession,
      addInterruptedSession: s.addInterruptedSession,
      removeInterruptedSession: s.removeInterruptedSession,
    })),
  );

  const {
    sessionUsage,
    currentModel,
    selectedVariant,
    setSessionUsage,
    setCurrentModel,
    setSelectedVariant,
  } = useSessionStore(
    useShallow((s) => ({
      sessionUsage: s.sessionUsage,
      currentModel: s.currentModel,
      selectedVariant: s.selectedVariant,
      setSessionUsage: s.setSessionUsage,
      setCurrentModel: s.setCurrentModel,
      setSelectedVariant: s.setSelectedVariant,
    })),
  );

  const {
    workspaces,
    preconfigs,
    prompts,
    models: storeModels,
    defaultModel: storeDefaultModel,
  } = useServerDataStore(useShallow((s) => ({
    workspaces: s.workspaces,
    preconfigs: s.preconfigs,
    prompts: s.prompts,
    models: s.models,
    defaultModel: s.defaultModel,
  })));

  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);
  const models = storeModels as ModelInfo[];
  const defaultModel = storeDefaultModel;

  useEffect(() => {
    const modelVariants = models.find(m => m.id === currentModel)?.variants;
    if (selectedVariant && modelVariants && !modelVariants[selectedVariant]) {
      setSelectedVariant(null);
    }
  }, [currentModel, selectedVariant, models, setSelectedVariant]);

  const { setCompletion, clearCompletion, clearAllCompletions } = useCompletionStore(
    useShallow((s) => ({
      setCompletion: s.setCompletion,
      clearCompletion: s.clearCompletion,
      clearAllCompletions: s.clearAllCompletions,
    })),
  );

  const { chatFinishSoundEnabled, permissionSoundEnabled } = useUIStore(
    useShallow((s) => ({
      chatFinishSoundEnabled: s.chatFinishSoundEnabled,
      permissionSoundEnabled: s.permissionSoundEnabled,
    })),
  );

  const permissionSoundEnabledRef = useRef(permissionSoundEnabled);
  useLayoutEffect(() => {
    permissionSoundEnabledRef.current = permissionSoundEnabled;
  }, [permissionSoundEnabled]);

  const chatFinishSoundEnabledRef = useRef(chatFinishSoundEnabled);
  useLayoutEffect(() => {
    chatFinishSoundEnabledRef.current = chatFinishSoundEnabled;
  }, [chatFinishSoundEnabled]);

  const [permissions, setPermissions] = useState<PermissionGrant[]>([]);
  const [_providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);

  const {
    pendingRequests: pendingAskRequests,
    addPendingRequest: addPendingAskRequest,
    removePendingRequest: removePendingAskRequest,
    removePendingPermissionRequest: removePendingPermissionAskRequest,
    replacePendingPermissionRequests: replacePendingPermissionAskRequests,
    clearPendingRequests: clearPendingAskRequests,
    clearPendingRequestsBySessionId: clearPendingAskRequestsBySessionId,
  } = useAskStore(
    useShallow((s) => ({
      pendingRequests: s.pendingRequests,
      addPendingRequest: s.addPendingRequest,
      removePendingRequest: s.removePendingRequest,
      removePendingPermissionRequest: s.removePendingPermissionRequest,
      replacePendingPermissionRequests: s.replacePendingPermissionRequests,
      clearPendingRequests: s.clearPendingRequests,
      clearPendingRequestsBySessionId: s.clearPendingRequestsBySessionId,
    })),
  );

  const {
    queuedMessages,
    clearQueuedMessages,
    setQueuedMessagesForSession,
    addQueuedMessage,
    removeQueuedMessageById,
  } = useSessionStore(
    useShallow((s) => ({
      queuedMessages: s.queuedMessages,
      clearQueuedMessages: s.clearQueuedMessages,
      setQueuedMessagesForSession: s.setQueuedMessagesForSession,
      addQueuedMessage: s.addQueuedMessage,
      removeQueuedMessageById: s.removeQueuedMessageById,
    })),
  );

  const authError = useConnectionStore(s => s.authError);
  const connectionTimedOut = useConnectionStore(s => s.connectionTimedOut);
  const retryCount = useConnectionStore(s => s.retryCount);
  const nextRetryIn = useConnectionStore(s => s.nextRetryIn);
  const connected = useConnectionStore(s => s.connected);
  const isCompacting = currentSession?.compacting ?? false;
  const { compactionSuccess, setCompactionSuccess } = useSessionStore(
    useShallow((s) => ({
      compactionSuccess: s.compactionSuccess,
      setCompactionSuccess: s.setCompactionSuccess,
    })),
  );

  const { playChatFinishSound, playPermissionSound } = useNotificationSound();

  // Register permission auto-approve handler
  usePermissionAutoApprove();

  const flushPendingPartAppends = useCallback(() => {
    if (partAppendRafRef.current !== null) {
      cancelAnimationFrame(partAppendRafRef.current);
      partAppendRafRef.current = null;
    }
    if (partAppendTimeoutRef.current !== null) {
      clearTimeout(partAppendTimeoutRef.current);
      partAppendTimeoutRef.current = null;
    }

    if (pendingPartAppendsRef.current.size === 0) return;

    const pending = new Map(pendingPartAppendsRef.current);
    pendingPartAppendsRef.current.clear();
    lastPartAppendFlushAtRef.current = Date.now();

    setPartsBySession(prev => {
      const newState = { ...prev };
      let hasChanges = false;

      for (const [partId, delta] of pending) {
        const location = partIdIndexRef.current.get(partId);
        if (!location) continue;

        const sessionParts = newState[location.sessionId];
        if (!sessionParts) continue;

        const messageParts = sessionParts[location.messageId];
        if (!messageParts) continue;

        const part = messageParts[location.index];
        if (!part || (part.type !== 'text' && part.type !== 'reasoning')) continue;

        hasChanges = true;
        const updatedMessageParts = [...messageParts];
        updatedMessageParts[location.index] = {
          ...part,
          text: part.text + delta,
        };

        newState[location.sessionId] = {
          ...sessionParts,
          [location.messageId]: updatedMessageParts,
        };
      }

      return hasChanges ? newState : prev;
    });
  }, [setPartsBySession]);

  useLayoutEffect(() => {
    const currentCount = useSessionStore.getState().getMessagesBySessionKeysCount();
    if (currentCount <= prevSessionKeyCountRef.current) {
      prevSessionKeyCountRef.current = currentCount;
      return;
    }
    prevSessionKeyCountRef.current = currentCount;

    const streamingIds = useConnectionStore.getState().streamingSessionIds;
    const protectedSessionIds = new Set<string>(streamingIds);
    // Protect all board-visible sessions from eviction
    const boardOpenIds = useSessionBoardStore.getState().openSessionIds;
    for (const id of boardOpenIds) {
      protectedSessionIds.add(id);
    }
    const evictedIds = evictToBudget(activeSessionId ?? null, protectedSessionIds);
    if (evictedIds.length > 0) {
      for (const id of evictedIds) {
        sessionAccessTimesRef.current.delete(id);
        for (const [partId, entry] of partIdIndexRef.current) {
          if (entry.sessionId === id) {
            partIdIndexRef.current.delete(partId);
          }
        }
      }
    }
  }, [activeSessionId]);

  const apiToken = activeServer?.token ?? null;
  const serverUrl = activeServer?.url ?? null;

  const sdkClient = sdkClientRef.current;

  useLayoutEffect(() => {
    currentSessionIdRef.current = currentSession?.id ?? null;
  }, [currentSession]);

  // Auto-resume session when arriving via direct URL (e.g. page refresh)
  // On refresh, WebSocket connects before sessions are loaded, so the normal
  // "resume on connect" logic in useConnectionLifecycle misses the sessionId.
  // This effect fires once sessions load and we derive currentSession from the URL.
  const hasResumedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (
      sessionIdFromUrl &&
      currentSession &&
      connected &&
      sdkClientRef.current &&
      !hasResumedRef.current.has(sessionIdFromUrl)
    ) {
      const hasMessages = activeSessionId
        ? !!useSessionStore.getState().messagesBySession[activeSessionId]?.length
        : false;
      if (!hasMessages) {
        hasResumedRef.current.add(sessionIdFromUrl);
        useSessionStore.getState().beginSessionContentLoad(sessionIdFromUrl);
        sdkClientRef.current.sessions.resume(sessionIdFromUrl);
      }
    }
  }, [sessionIdFromUrl, currentSession, connected, activeSessionId]);

  useEffect(() => {
    notifiedToolCallIdsRef.current.clear();
  }, [currentSession?.id]);

  useLayoutEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);



  const { removeServer } = useServerContext();

  const handleLogout = useCallback(() => {
    if (activeServer) {
      removeServer(activeServer.id);
      navigate({ to: '/' });
    }
    sdkClientRef.current?.dispose();
    useConnectionStore.getState().resetConnection();
  }, [activeServer, removeServer, navigate, sdkClientRef]);

  const { retry } = useConnectionLifecycle({
    apiToken,
    serverUrl,
    currentSessionIdRef,
    handlerContextRef,
    handleLogout,
    clientRef: sdkClientRef,
  });

  const handleRetry = useCallback(() => {
    retry();
  }, [retry]);

  const createWorkspace = async (name: string, path: string, isVirtual: boolean) => {
    const http = sdkClientRef.current?.httpClient;
    if (!http) return;

    const data = await http.post<{ workspace: Workspace }>('/workspaces', { name, path, isVirtual });
    const workspace = data.workspace;
    useServerDataStore.getState().setWorkspaces([...useServerDataStore.getState().workspaces, workspace]);
    useServerDataStore.getState().setActiveWorkspace(workspace);
    localStorage.setItem('activeWorkspaceId', workspace.id);
    setCurrentSession(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    navigate({ to: '/server/$serverId/workspace', params: { serverId: _serverId } });
    return workspace;
  };

  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null);
  const [isUpdatingWorkspace, setIsUpdatingWorkspace] = useState<Record<string, boolean>>({});

  const selectWorkspace = useCallback((workspace: Workspace) => {
    useServerDataStore.getState().setActiveWorkspace(workspace);
    localStorage.setItem('activeWorkspaceId', workspace.id);
    setCurrentSession(null);
    useSessionBoardStore.getState().clearBoard();
    navigate({ to: '/server/$serverId/workspace', params: { serverId: _serverId } });
  }, [setCurrentSession, navigate, _serverId]);

  const deleteWorkspace = async (id: string) => {
    const http = sdkClientRef.current?.httpClient;
    if (!http) return;

    setDeletingWorkspaceId(id);
    let deletedSessions: string[] = [];
    try {
      const data = await http.delete<{ deletedSessions: string[] }>(`/workspaces/${id}`);
      deletedSessions = data.deletedSessions;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to delete workspace:', message);
      toast.error('Failed to delete workspace', { description: message });
      setDeletingWorkspaceId(null);
      return;
    }

    removeFromQuickConnectionsByWorkspace(id);
    useOverviewGroupsStore.getState().removeWorkspaceFromAllGroups(_serverId, id);

    if (currentSession && (currentSession.workspaceId === id || deletedSessions.includes(currentSession.id))) {
      setCurrentSession(null);
      navigate({ to: '/server/$serverId/workspace', params: { serverId: _serverId } });
    }

    setSessions(prev => prev.filter(s => !deletedSessions.includes(s.id)));

    useSessionStore.getState().evictSessionContentBatch(deletedSessions);
    deletedSessions.forEach(sessionId => sessionAccessTimesRef.current.delete(sessionId));

    for (const [partId, entry] of partIdIndexRef.current) {
      if (deletedSessions.includes(entry.sessionId)) {
        partIdIndexRef.current.delete(partId);
      }
    }

    const currentWorkspaces = useServerDataStore.getState().workspaces;
    useServerDataStore.getState().setWorkspaces(currentWorkspaces.filter(w => w.id !== id));
    const currentActive = useServerDataStore.getState().activeWorkspace;
    if (currentActive?.id === id) {
      const remaining = currentWorkspaces.filter(w => w.id !== id);
      const newActive = remaining[0] || null;
      useServerDataStore.getState().setActiveWorkspace(newActive);
      if (newActive) {
        localStorage.setItem('activeWorkspaceId', newActive.id);
      } else {
        localStorage.removeItem('activeWorkspaceId');
      }
    }

    queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    setDeletingWorkspaceId(null);
  };

  const renameWorkspace = async (id: string, name: string) => {
    const http = sdkClientRef.current?.httpClient;
    if (!http) return;

    setIsUpdatingWorkspace(prev => ({ ...prev, [id]: true }));
    try {
      const data = await http.patch<{ workspace: Workspace }>(`/workspaces/${id}`, { name });
      const updatedWorkspace = data.workspace;

      const currentWorkspaces = useServerDataStore.getState().workspaces;
      useServerDataStore.getState().setWorkspaces(
        currentWorkspaces.map(w => w.id === id ? updatedWorkspace : w),
      );

      if (useServerDataStore.getState().activeWorkspace?.id === id) {
        useServerDataStore.getState().setActiveWorkspace(updatedWorkspace);
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to rename workspace:', message);
      toast.error('Failed to rename workspace', { description: message });
    } finally {
      setIsUpdatingWorkspace(prev => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  const updateWorkspacePaths = async (id: string, additionalPaths: string[]) => {
    const http = sdkClientRef.current?.httpClient;
    if (!http) return;

    setIsUpdatingWorkspace(prev => ({ ...prev, [id]: true }));
    try {
      const data = await http.patch<{ workspace: Workspace }>(`/workspaces/${id}`, { additionalPaths });
      const updatedWorkspace = data.workspace;

      const currentWorkspaces = useServerDataStore.getState().workspaces;
      useServerDataStore.getState().setWorkspaces(
        currentWorkspaces.map(w => w.id === id ? updatedWorkspace : w),
      );

      if (useServerDataStore.getState().activeWorkspace?.id === id) {
        useServerDataStore.getState().setActiveWorkspace(updatedWorkspace);
      }
      toast.success('Workspace paths updated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to update workspace paths:', message);
      toast.error('Failed to update workspace paths', { description: message });
    } finally {
      setIsUpdatingWorkspace(prev => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  const updateWorkspaceSettings = async (id: string, settings: WorkspaceSettings) => {
    const http = sdkClientRef.current?.httpClient;
    if (!http) return;

    setIsUpdatingWorkspace(prev => ({ ...prev, [id]: true }));
    try {
      const data = await http.patch<{ workspace: Workspace }>(`/workspaces/${id}`, { settings });
      const updatedWorkspace = data.workspace;

      const currentWorkspaces = useServerDataStore.getState().workspaces;
      useServerDataStore.getState().setWorkspaces(
        currentWorkspaces.map(w => w.id === id ? updatedWorkspace : w),
      );

      if (useServerDataStore.getState().activeWorkspace?.id === id) {
        useServerDataStore.getState().setActiveWorkspace(updatedWorkspace);
      }
      toast.success('Workspace settings saved');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to update workspace settings:', message);
      toast.error('Failed to update workspace settings', { description: message });
    } finally {
      setIsUpdatingWorkspace(prev => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  const handleCreateVirtualWorkspace = async () => {
    const name = `Workspace ${workspaces.length + 1}`;
    const path = `~/.prokopai/workspaces/${crypto.randomUUID()}`;
    setIsCreatingWorkspace(true);
    try {
      await createWorkspace(name, path, true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Failed to create workspace', { description: message });
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const handleCreatePhysicalWorkspace = async (path: string) => {
    const name = path.split('/').pop() || path.split('\\').pop() || 'Workspace';
    setIsCreatingWorkspace(true);
    try {
      await createWorkspace(name, path, false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Failed to create workspace', { description: message });
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  useLayoutEffect(() => {
    handlerContextRef.current = {
      setSessions,
      setCurrentSession,
      setMessagesBySession,
      setPartsBySession,
      setSessionUsage,
      setCurrentModel,
      setSelectedVariant,
      addStreamingSession,
      removeStreamingSession,
      addInterruptedSession,
      removeInterruptedSession,
      setQueuedMessagesForSession,
      addQueuedMessage,
      removeQueuedMessageById,
      clearQueuedMessages,
      setCompactionSuccess,
      setUsageForSession: useSessionStore.getState().setUsageForSession,
      setModelForSession: useSessionStore.getState().setModelForSession,
      setVariantForSession: useSessionStore.getState().setVariantForSession,
      setCompactionSuccessForSession: useSessionStore.getState().setCompactionSuccessForSession,
      setCompletion,
      clearCompletion,
      clearAllCompletions,
      pendingSessionCreateRef,
      sessionAccessTimesRef,
      partIdIndexRef,
      partAppendRafRef,
      pendingPartAppendsRef,
      lastPartAppendFlushAtRef,
      partAppendTimeoutRef,
      skipFinishSoundSessionIdsRef,
      currentSessionIdRef,
      models: useServerDataStore.getState().models as ModelInfo[],
      defaultModel: useServerDataStore.getState().defaultModel,
      interruptedSessions,
      sessionsRef,
      flushPendingPartAppends,
      beginSessionContentLoad: useSessionStore.getState().beginSessionContentLoad,
      replaceSessionContent: useSessionStore.getState().replaceSessionContent,
      failSessionContentLoad: useSessionStore.getState().failSessionContentLoad,
      touchSessionContent: useSessionStore.getState().touchSessionContent,
      setProviderStatuses,
      setPermissions,
      notifiedToolCallIdsRef,
      permissionSoundEnabledRef,
      playPermissionSound,
      chatFinishSoundEnabledRef,
      playChatFinishSound,
      navigateToSession: (sessionId: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        navigate({ to: `/server/$serverId${viewPath}/session/$sessionId` as any, params: { serverId: _serverId, sessionId } });
      },
      navigateToSessionWithOpen: (sessionId: string, openParam?: string) => {
        navigate({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          to: `/server/$serverId${viewPath}/session/$sessionId` as any,
          params: { serverId: _serverId, sessionId },
          ...(openParam ? { search: { open: openParam } as Record<string, unknown> } : {}),
        });
      },
      navigateToParent: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        navigate({ to: `/server/$serverId${viewPath}` as any, params: { serverId: _serverId } });
      },
      serverId: _serverId,
      // Ask handlers
      addPendingAskRequest,
      removePendingAskRequest,
      removePendingPermissionRequest: removePendingPermissionAskRequest,
      replacePendingPermissionRequests: replacePendingPermissionAskRequests,
      clearPendingAskRequests,
      clearPendingAskRequestsBySessionId,
      runAskHandlers: (target, request) => {
        const handlers = useAskStore.getState().getHandlers(target);
        if (handlers.length === 0) return undefined;

        // Run handlers sequentially, first non-undefined result wins
        return (async () => {
          for (const handler of handlers) {
            try {
              const result = await handler(request);
              if (result !== undefined) return result;
            } catch {
              continue;
            }
          }
          return undefined;
        })();
      },
      sendAskResponse: (toolCallId, response, requestId) => {
        const client = sdkClientRef.current;
        // For permission asks, use requestId as canonical identity
        if (requestId) {
          removePendingPermissionAskRequest(requestId, toolCallId);
        } else {
          removePendingAskRequest(toolCallId);
        }
        if (client && client.connected) {
          client.send({
            type: 'ask.response',
            toolCallId,
            response,
            requestId,
          });
        }
      },
      acknowledgeNotification: (eventId: string, sessionId: string) => {
        const client = sdkClientRef.current;
        if (client && client.connected) {
          client.notifications.acknowledge(eventId, sessionId);
        }
      },
      resumeSessionAfterCreate: (sessionId: string) => {
        const client = sdkClientRef.current;
        useSessionStore.getState().setNavigationIntent({ mode: 'follow' });
        if (client && client.connected) {
          client.sessions.resume(sessionId);
        }
      },
    };
  });

  const primaryPreconfigs = preconfigs.filter(p => p.mode !== 'subagent');

  const {
    createSession,
    resumeSession,
    openAlongside,
    closeSession,
    reopenSession,
    permanentlyDeleteSession,
    handleRenameSession,
    regenerateSessionTitle,
    revertSession,
    forkSession,
    editMessage,
    compactSession,
    removeFromQueue,
    sendChatMessage,
    sendChatMessageForSession,
    handleAskResponse,
    handleInterruptSession,
    handleInterruptSessionById,
    updateSessionPreconfig,
    updateSessionPreconfigForSession,
    updateSessionModel,
    updateSessionModelForSession,
    updateSessionVariant,
    updateSessionVariantForSession,
    handleNavigateBack,
    refreshPermissions,
    createSessionInWorkspace,
    revokePermission,
    revokeAllPermissions,
    claimControl,
  } = useSessionCommands({
    clientRef: sdkClientRef,
    currentSession,
    sessions,
    workspaces,
    activeWorkspace,
    streamingSessionIds,
    primaryPreconfigs,
    setActiveWorkspace: (ws: Workspace | null) => useServerDataStore.getState().setActiveWorkspace(ws),
    removePendingAskRequest,
    removePendingPermissionRequest: removePendingPermissionAskRequest,
    clearPendingAskRequestsBySessionId,
    clearStreamingSessions: useConnectionStore.getState().clearStreamingSessions,
    pendingSessionCreateRef,
    partAppendRafRef,
    pendingPartAppendsRef,
    skipFinishSoundSessionIdsRef,
    navigate,
    serverId: _serverId,
    viewPath,
  });

  const workspaceSessions = sessions.filter(s => s.workspaceId === activeWorkspace?.id);

  const favoritedWorkspaceIds = quickConnections
    .filter(conn => conn.serverId === activeServer?.id && conn.workspaceId)
    .map(conn => conn.workspaceId!);



  const isPrimarySession = !currentSession?.parentId;

  return {
    connected,
    authError,
    connectionTimedOut,
    retryCount,
    nextRetryIn,
    serverUrl,
    apiToken,

    sdkClient,

    currentSession,
    sessions,
    workspaceSessions,

    pendingAskRequests,
    queuedMessages,

    sessionUsage,
    currentModel,
    selectedVariant,
    isCompacting,
    compactionSuccess,
    isPrimarySession,
    isSessionLoading,

    workspaces,
    activeWorkspace,
    preconfigs,
    primaryPreconfigs,
    prompts,
    models,
    defaultModel,

    streamingSessionIds,

    createSession,
    resumeSession,
    openAlongside,
    closeSession,
    reopenSession,
    permanentlyDeleteSession,
    handleRenameSession,
    regenerateSessionTitle,
    revertSession,
    forkSession,
    editMessage,
    compactSession,
    removeFromQueue,
    sendChatMessage,
    sendChatMessageForSession,
    handleAskResponse,
    handleInterruptSession,
    handleInterruptSessionById,
    updateSessionPreconfig,
    updateSessionPreconfigForSession,
    updateSessionModel,
    updateSessionModelForSession,
    updateSessionVariant,
    updateSessionVariantForSession,
    handleNavigateBack,
    refreshPermissions,
    createSessionInWorkspace,
    revokePermission,
    revokeAllPermissions,

    claimControl,

    selectWorkspace,
    renameWorkspace,
    updateWorkspacePaths,
    updateWorkspaceSettings,
    handleCreateVirtualWorkspace,
    handleCreatePhysicalWorkspace,
    deleteWorkspace,
    isCreatingWorkspace,
    deletingWorkspaceId,
    isUpdatingWorkspace,

    handleLogout,
    handleRetry,

    favoritedWorkspaceIds,

    setCompactionSuccess,

    permissions,
  };
}
