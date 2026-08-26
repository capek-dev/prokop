import { useCallback } from 'react';
import type {
  Session,
  Workspace,
  Preconfig,
  AttachmentKind,
  AskResponse,
} from '@prokopai/sdk';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import type { PendingSessionCreateIntent } from '@/stores/sessionBoardStore';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import type { ResumeSessionOptions } from '@/stores/sessionStore';
import { getWorkspaceDefaultPreconfigId } from '@/lib/workspacePreconfigs';
import { getSessionCreateBoardAction } from '@/lib/sessionCreate';
import type { CreateSessionOptions } from '@/lib/sessionCreate';

interface UseSessionCommandsParams {
  clientRef: React.RefObject<ProkopaiClient | null>;
  currentSession: Session | null;
  sessions: Session[];
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  streamingSessionIds: Set<string>;
  primaryPreconfigs: Preconfig[];
  setActiveWorkspace: (workspace: Workspace | null) => void;
  removePendingAskRequest: (toolCallId: string) => void;
  removePendingPermissionRequest: (requestId: string, toolCallId?: string) => void;
  clearPendingAskRequestsBySessionId: (sessionId: string) => void;
  clearStreamingSessions: () => void;
  pendingSessionCreateRef: React.RefObject<PendingSessionCreateIntent | null>;
  partAppendRafRef: React.RefObject<number | null>;
  pendingPartAppendsRef: React.RefObject<Map<string, string>>;
  skipFinishSoundSessionIdsRef: React.RefObject<Set<string>>;
  navigate: (opts: { to: string; params?: Record<string, string>; search?: Record<string, unknown> }) => void;
  serverId: string;
  viewPath: string;
}

interface UseSessionCommandsReturn {
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
  addToQueue: (sessionId: string, content: string, attachments?: Array<{ id: string; kind: AttachmentKind }>) => void;
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
}

export function useSessionCommands({
  clientRef,
  currentSession,
  sessions,
  workspaces,
  activeWorkspace,
  streamingSessionIds,
  primaryPreconfigs,
  setActiveWorkspace,
  removePendingAskRequest,
  removePendingPermissionRequest,
  clearPendingAskRequestsBySessionId: _clearPendingAskRequestsBySessionId,
  clearStreamingSessions: _clearStreamingSessions,
  pendingSessionCreateRef,
  partAppendRafRef,
  pendingPartAppendsRef,
  skipFinishSoundSessionIdsRef: _skipFinishSoundSessionIdsRef,
  navigate,
  serverId,
  viewPath,
}: UseSessionCommandsParams): UseSessionCommandsReturn {

  const createSession = useCallback((preconfigId?: string, title?: string, options?: CreateSessionOptions) => {
    const client = clientRef.current;
    pendingSessionCreateRef.current = activeWorkspace
      ? {
          workspaceId: activeWorkspace.id,
          boardAction: getSessionCreateBoardAction(options),
        }
      : null;
    if (partAppendRafRef.current !== null) {
      cancelAnimationFrame(partAppendRafRef.current);
      partAppendRafRef.current = null;
    }
    pendingPartAppendsRef.current.clear();
    if (client && client.connected) {
      client.sessions.create({
        preconfigId,
        title,
        workspaceId: activeWorkspace?.id,
      });
    }
  }, [clientRef, partAppendRafRef, pendingPartAppendsRef, pendingSessionCreateRef, activeWorkspace]);

  const resumeSession = useCallback((sessionId: string, options?: ResumeSessionOptions) => {
    const client = clientRef.current;
    const store = useSessionStore.getState();
    store.setNavigationIntentForSession(
      sessionId,
      options?.targetMessageId
        ? { mode: 'target-message', messageId: options.targetMessageId }
        : { mode: 'follow' }
    );
    store.setCompactionSuccessForSession(sessionId, false);
    const session = sessions.find(s => s.id === sessionId);
    if (session?.workspaceId && session.workspaceId !== activeWorkspace?.id) {
      const targetWorkspace = workspaces.find(w => w.id === session.workspaceId);
      if (targetWorkspace) {
        setActiveWorkspace(targetWorkspace);
      }
    }
    const contentMeta = store.contentMetaBySession[sessionId];
    const hasCachedContent = contentMeta?.status === 'ready' && !!store.messagesBySession[sessionId];

    if (hasCachedContent) {
      store.touchSessionContent(sessionId);
    } else {
      store.beginSessionContentLoad(sessionId);
    }

    if (!session && client && client.connected) {
      client.http.sessions.get(sessionId).then((response: { session: Session }) => {
        useSessionStore.getState().addSessionToFront(response.session);
      }).catch(() => {});
    }

    if (client && client.connected) {
      client.sessions.resume(sessionId);
    }
    // Update board state: if already open, just focus; otherwise replace focused pane
    const board = useSessionBoardStore.getState();
    if (board.openSessionIds.includes(sessionId)) {
      board.focusSession(sessionId);
    } else {
      board.openInFocusedPane(sessionId);
    }

    if (options?.skipNavigation) {
      return;
    }

    // Build navigation URL with open param
    const newBoard = useSessionBoardStore.getState();
    const openParam = newBoard.openSessionIds.length > 1
      ? newBoard.openSessionIds.join(',')
      : undefined;
    navigate({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      to: `/server/$serverId${viewPath}/session/$sessionId` as any,
      params: { serverId, sessionId: newBoard.focusedSessionId ?? sessionId },
      ...(openParam ? { search: { open: openParam } as Record<string, unknown> } : {}),
    });
  }, [clientRef, sessions, workspaces, activeWorkspace, setActiveWorkspace, navigate, serverId, viewPath]);

  const openAlongside = useCallback((sessionId: string) => {
    const client = clientRef.current;
    const store = useSessionStore.getState();
    const board = useSessionBoardStore.getState();

    // If already open, just focus
    if (board.openSessionIds.includes(sessionId)) {
      board.focusSession(sessionId);
    } else {
      board.openAlongside(sessionId);
    }

    // Load content if needed
    const contentMeta = store.contentMetaBySession[sessionId];
    const hasCachedContent = contentMeta?.status === 'ready' && !!store.messagesBySession[sessionId];
    if (!hasCachedContent) {
      store.beginSessionContentLoad(sessionId);
    }

    if (client && client.connected) {
      client.sessions.resume(sessionId);
    }

    // Navigate with open param
    const newBoard = useSessionBoardStore.getState();
    const openParam = newBoard.openSessionIds.length > 1
      ? newBoard.openSessionIds.join(',')
      : undefined;
    navigate({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      to: `/server/$serverId${viewPath}/session/$sessionId` as any,
      params: { serverId, sessionId: newBoard.focusedSessionId ?? sessionId },
      ...(openParam ? { search: { open: openParam } as Record<string, unknown> } : {}),
    });
  }, [clientRef, navigate, serverId, viewPath]);

  const closeSession = useCallback((sessionId: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      client.sessions.close(sessionId);
    }
  }, [clientRef]);

  const revertSession = useCallback((sessionId: string, messageId: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      usePendingOperationsStore.getState().startOperation({ type: 'revert', sessionId, messageId, startedAt: Date.now() });
      client.sessions.revert(sessionId, messageId);
    }
  }, [clientRef]);

  const forkSession = useCallback((sessionId: string, messageId: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      usePendingOperationsStore.getState().startOperation({ type: 'fork', sessionId, messageId, startedAt: Date.now() });
      client.sessions.fork(sessionId, messageId);
    }
  }, [clientRef]);

  const editMessage = useCallback((sessionId: string, messageId: string, content: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      usePendingOperationsStore.getState().startOperation({ type: 'edit', sessionId, messageId, startedAt: Date.now() });
      client.sessions.editMessage(sessionId, messageId, content);
    }
  }, [clientRef]);

  const compactSession = useCallback((sessionId: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      usePendingOperationsStore.getState().startOperation({ type: 'compact', sessionId, startedAt: Date.now() });
      client.sessions.compact(sessionId);
    }
  }, [clientRef]);

  const reopenSession = useCallback((sessionId: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      client.sessions.reopen(sessionId);
    }
  }, [clientRef]);

  const permanentlyDeleteSession = useCallback((sessionId: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      usePendingOperationsStore.getState().startOperation({ type: 'delete', sessionId, startedAt: Date.now() });
      client.sessions.delete(sessionId);
    }
  }, [clientRef]);

  const updateSessionPreconfigForSession = useCallback((sessionId: string, preconfigId: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      client.sessions.update(sessionId, { preconfigId });
    }
  }, [clientRef]);

  const updateSessionPreconfig = useCallback((preconfigId: string) => {
    if (currentSession) {
      updateSessionPreconfigForSession(currentSession.id, preconfigId);
    }
  }, [currentSession, updateSessionPreconfigForSession]);

  const updateSessionModelForSession = useCallback((sessionId: string, modelId: string, providerId: string) => {
    const client = clientRef.current;
    const store = useSessionStore.getState();
    store.setModelForSession(sessionId, modelId);
    store.setVariantForSession(sessionId, null);
    if (client && client.connected) {
      client.sessions.updateModel(sessionId, { modelId, providerId });
    }
  }, [clientRef]);

  const updateSessionModel = useCallback((modelId: string, providerId: string) => {
    if (currentSession) {
      updateSessionModelForSession(currentSession.id, modelId, providerId);
    }
  }, [currentSession, updateSessionModelForSession]);

  const updateSessionVariantForSession = useCallback((sessionId: string, variant: string | null) => {
    const client = clientRef.current;
    const session = sessions.find(s => s.id === sessionId);
    const store = useSessionStore.getState();
    const sessionModel = session?.selectedModel || store.getModelForSession(sessionId);
    if (client && client.connected && session) {
      client.sessions.updateModel(sessionId, {
        modelId: sessionModel,
        providerId: session.selectedProvider || 'openai',
        variant: variant ?? undefined,
      });
      store.setVariantForSession(sessionId, variant);
    }
  }, [clientRef, sessions]);

  const updateSessionVariant = useCallback((variant: string | null) => {
    if (currentSession) {
      updateSessionVariantForSession(currentSession.id, variant);
    }
  }, [currentSession, updateSessionVariantForSession]);

  const handleRenameSession = useCallback((sessionId: string, title: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      usePendingOperationsStore.getState().startOperation({ type: 'rename', sessionId, startedAt: Date.now() });
      client.sessions.rename(sessionId, title);
    }
  }, [clientRef]);

  const regenerateSessionTitle = useCallback((sessionId: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      usePendingOperationsStore.getState().startOperation({ type: 'regenerate_title', sessionId, startedAt: Date.now() });
      client.sessions.generateTitle(sessionId);
    }
  }, [clientRef]);

  const handleNavigateBack = useCallback(() => {
    if (currentSession?.parentId) {
      resumeSession(currentSession.parentId);
    }
  }, [currentSession, resumeSession]);

  const addToQueue = useCallback((sessionId: string, content: string, attachments?: Array<{ id: string; kind: AttachmentKind }>, responseFormatId?: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      client.queue.add(sessionId, content, { attachments, responseFormatId });
    }
  }, [clientRef]);

  const removeFromQueue = useCallback((queueId: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      client.queue.remove(queueId);
    }
  }, [clientRef]);

  const sendChatMessageForSession = useCallback((sessionId: string, content: string, attachments?: Array<{ id: string; kind: AttachmentKind }>, responseFormatId?: string, goal?: { condition: string; maxTurns?: number }) => {
    const client = clientRef.current;
    const session = sessions.find(s => s.id === sessionId);
    if (!session || session.compacting) return;
    if (session.runningAt || streamingSessionIds.has(sessionId)) {
      addToQueue(sessionId, content, attachments, responseFormatId);
    } else {
      if (client && client.connected) {
        client.chat.send(
          sessionId,
          content,
          { attachments, responseFormatId, goalCondition: goal?.condition, goalMaxTurns: goal?.maxTurns },
        );
      }
    }
  }, [clientRef, sessions, streamingSessionIds, addToQueue]);

  const sendChatMessage = useCallback((content: string, attachments?: Array<{ id: string; kind: AttachmentKind }>, responseFormatId?: string, goal?: { condition: string; maxTurns?: number }) => {
    if (!currentSession) return;
    sendChatMessageForSession(currentSession.id, content, attachments, responseFormatId, goal);
  }, [currentSession, sendChatMessageForSession]);

  const handleAskResponse = useCallback((toolCallId: string, response: AskResponse, requestId?: string) => {
    const client = clientRef.current;
    // For permission asks, use requestId as canonical identity
    if (requestId) {
      removePendingPermissionRequest(requestId, toolCallId);
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
  }, [clientRef, removePendingAskRequest, removePendingPermissionRequest]);

  const handleInterruptSessionById = useCallback((sessionId: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      client.sessions.interrupt(sessionId);
    }
  }, [clientRef]);

  const handleInterruptSession = useCallback(() => {
    if (currentSession) {
      handleInterruptSessionById(currentSession.id);
    }
  }, [currentSession, handleInterruptSessionById]);

  const refreshPermissions = useCallback(() => {
    const client = clientRef.current;
    if (client && client.connected && activeWorkspace) {
      client.permissions.list(activeWorkspace.id);
    }
  }, [clientRef, activeWorkspace]);

  const createSessionInWorkspace = useCallback((workspaceId: string, options?: CreateSessionOptions) => {
    const client = clientRef.current;
    const ws = workspaces.find(w => w.id === workspaceId) || null;
    setActiveWorkspace(ws);
    pendingSessionCreateRef.current = {
      workspaceId,
      boardAction: getSessionCreateBoardAction(options),
    };
    if (partAppendRafRef.current !== null) {
      cancelAnimationFrame(partAppendRafRef.current);
      partAppendRafRef.current = null;
    }
    pendingPartAppendsRef.current.clear();
    const defaultId = ws
      ? getWorkspaceDefaultPreconfigId(ws, primaryPreconfigs)
      : primaryPreconfigs[0]?.id;
    if (client && client.connected) {
      client.sessions.create({ preconfigId: defaultId, workspaceId });
    }
  }, [clientRef, partAppendRafRef, pendingPartAppendsRef, pendingSessionCreateRef, workspaces, primaryPreconfigs, setActiveWorkspace]);

  const revokePermission = useCallback((permissionId: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      client.permissions.revoke(permissionId);
    }
  }, [clientRef]);

  const revokeAllPermissions = useCallback((workspaceId: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      client.permissions.revokeAll(workspaceId);
    }
  }, [clientRef]);

  const claimControl = useCallback((sessionId: string) => {
    const client = clientRef.current;
    if (client && client.connected) {
      client.control.claim(sessionId);
    }
  }, [clientRef]);

  return {
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
    addToQueue,
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
  };
}
