import type { ServerWebSocket } from 'bun';
import type { RouterContext } from '../router-context';
import { sendGateRejection } from '../router-context';
import {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  listLatestMessagesWithPartsPage,
  reconcileSessionCompaction,
  reconcileOrphanedToolCalls,
} from '@/store';
import { getWorkspaceAutoApproveSeverity } from '@/store/workspaces';
import { getPreconfigOrAgent, isAgentSync } from '@/agents/storage';
import { interruptManager } from '@capekai/core/compat/jean2';
import { broadcastSessionCreatedExclude } from '@/core/broadcast';
import { checkControllerGate } from '../session-control-registry';
import {
  handleSessionResume as handleControlSessionResume,
  buildControlUpdatedMessage,
} from '../session-control-registry';
import { markManualSessionTitle } from '../session-title';
import { regenerateSessionTitle } from '../chat-handler';
import type {
  SessionCreateMessage,
  SessionResumeMessage,
  SessionUpdateMessage,
  SessionUpdateModelMessage,
  SessionCloseMessage,
  SessionReopenMessage,
  SessionDeleteMessage,
  SessionRenameMessage,
  SessionGenerateTitleMessage,
  SessionInterruptMessage,
  Ask,
  AskAuthority,
} from '@jean2/sdk';
import {
  ASK_TIMEOUT,
  getAuthorityForPendingAsk,
} from '@capekai/core/compat/jean2';
import {
  listAllPendingAsks,
  cleanupAllPendingAsks,
  listPendingRequestsByRootSession,
} from '@/store/pending-asks';
import { listQueuedMessages } from '@/store';

export async function handleCreateSession(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: SessionCreateMessage,
): Promise<void> {
  const sessionId = crypto.randomUUID();
  const workspaceAutoApprove = getWorkspaceAutoApproveSeverity(msg.workspaceId || '');
  const session = createSession({
    id: sessionId,
    workspaceId: msg.workspaceId || '',
    preconfigId: msg.preconfigId || null,
    title: msg.title || 'New Session',
    status: 'active',
    metadata: null,
    parentId: null,
    agentName: null,
    autoApproveSeverity: workspaceAutoApprove,
  });
  // Add to connection's active session set
  const existingEntry = ctx.clients.get(ws);
  if (existingEntry) {
    existingEntry.sessionIds.add(session.id);
  } else {
    ctx.clients.set(ws, { sessionIds: new Set([session.id]), missedPings: 0 });
  }

  if (msg.preconfigId) {
    const preconfig = await getPreconfigOrAgent(msg.preconfigId);
    if (preconfig) {
      const updates: { selectedModel?: string; selectedProvider?: string; selectedVariant?: string | null; agentId?: string | null } = {};
      if (preconfig.model) updates.selectedModel = preconfig.model;
      if (preconfig.provider) updates.selectedProvider = preconfig.provider;
      updates.selectedVariant = preconfig.variant ?? null;
      updates.agentId = isAgentSync(msg.preconfigId) ? msg.preconfigId : null;
      const updated = updateSession(sessionId, updates);
      ctx.send(ws, { type: 'session.created', session: updated! });
      broadcastSessionCreatedExclude(updated!, ws);
      return;
    }
  }

  ctx.send(ws, { type: 'session.created', session });
  broadcastSessionCreatedExclude(session, ws);
}

export async function handleResumeSession(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: SessionResumeMessage,
): Promise<void> {
  const session = getSession(msg.sessionId);
  if (!session) {
    ctx.send(ws, { type: 'error', code: 'not_found', message: 'Session not found' });
    return;
  }
  // Add to connection's active session set (multi-session safe)
  const existingEntry = ctx.clients.get(ws);
  if (existingEntry) {
    existingEntry.sessionIds.add(session.id);
  } else {
    ctx.clients.set(ws, { sessionIds: new Set([session.id]), missedPings: 0 });
  }

  const controlResult = handleControlSessionResume(session.id, ws);

  const isRunning = interruptManager.isSessionActive(session.id);

  reconcileSessionCompaction(session.id);
  if (!isRunning) {
    reconcileOrphanedToolCalls(session.id);
  }

  const reconciledSession = getSession(msg.sessionId);
  const transcriptPage = listLatestMessagesWithPartsPage(session.id, 50);

  ctx.send(ws, {
    type: 'session.resumed',
    session: reconciledSession!,
    messages: transcriptPage.messages,
    transcript: {
      messages: transcriptPage.messages,
      pagination: transcriptPage.pagination,
    },
    usage: reconciledSession!.totalTokens ? {
      promptTokens: reconciledSession!.promptTokens ?? 0,
      completionTokens: reconciledSession!.completionTokens ?? 0,
      totalTokens: reconciledSession!.totalTokens ?? 0,
      cacheReadTokens: reconciledSession!.cacheReadTokens ?? 0,
      cacheWriteTokens: reconciledSession!.cacheWriteTokens ?? 0,
      noCacheTokens: reconciledSession!.noCacheTokens ?? 0,
    } : undefined,
    isRunning,
    control: controlResult.controlState,
  });

  if (controlResult.transitionReason) {
    ctx.broadcastToSession(session.id, buildControlUpdatedMessage(session.id, controlResult.transitionReason), ws);
  }

  const queuedMessages = listQueuedMessages(msg.sessionId);
  if (queuedMessages.length > 0) {
    ctx.send(ws, {
      type: 'queue.list',
      sessionId: msg.sessionId,
      messages: queuedMessages,
    });
  }

  cleanupAllPendingAsks(ASK_TIMEOUT);

  const activePendingAsks = listPendingRequestsByRootSession(msg.sessionId);
  const syncRequests: Array<{
    sessionId: string;
    toolCallId: string;
    toolName: string;
    ask: Ask;
    requestId?: string;
    _originSessionId?: string;
    authority?: AskAuthority;
  }> = [];

  for (const ask of activePendingAsks) {
    const hasRootContext = ask.rootSessionId && ask.rootSessionId !== ask.sessionId;
    const canonicalSessionId = hasRootContext ? ask.rootSessionId! : ask.sessionId;
    const askPayload = hasRootContext
      ? { ...ask.ask, _originSessionId: ask.sessionId }
      : ask.ask;
    const askAuthority = getAuthorityForPendingAsk(ask.toolCallId);
    syncRequests.push({
      sessionId: canonicalSessionId,
      toolCallId: ask.toolCallId,
      toolName: ask.toolName,
      ask: askPayload as unknown as Ask,
      requestId: ask.requestId,
      ...(hasRootContext ? { _originSessionId: ask.sessionId } : {}),
      authority: askAuthority ?? { visibilityScope: 'controller_only' as const, resolutionMode: 'controller_only' as const },
    });
  }

  const otherPendingAsks = listAllPendingAsks().filter(
    (ask) =>
      ask.status === 'pending' &&
      ask.sessionId !== msg.sessionId &&
      !activePendingAsks.some((pa) => pa.requestId === ask.requestId),
  );
  for (const ask of otherPendingAsks) {
    const hasRootContext = ask.rootSessionId && ask.rootSessionId !== ask.sessionId;
    const effectiveSessionId = hasRootContext ? ask.rootSessionId! : ask.sessionId;
    const askPayload = hasRootContext
      ? { ...ask.ask, _originSessionId: ask.sessionId }
      : ask.ask;
    const askAuthority = getAuthorityForPendingAsk(ask.toolCallId);
    syncRequests.push({
      sessionId: effectiveSessionId,
      toolCallId: ask.toolCallId,
      toolName: ask.toolName,
      ask: askPayload as unknown as Ask,
      requestId: ask.requestId,
      ...(hasRootContext ? { _originSessionId: ask.sessionId } : {}),
      authority: askAuthority ?? { visibilityScope: 'controller_only' as const, resolutionMode: 'controller_only' as const },
    });
  }

  ctx.send(ws, {
    type: 'ask.pending_sync',
    sessionId: msg.sessionId,
    requests: syncRequests,
  });
}

export async function handleUpdateSession(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: SessionUpdateMessage,
): Promise<void> {
  const session = getSession(msg.sessionId);
  if (!session) {
    ctx.send(ws, { type: 'error', code: 'not_found', message: 'Session not found' });
    return;
  }
  const gate = checkControllerGate(msg.sessionId, 'session.update', ws);
  if (gate) { sendGateRejection(ctx, ws, gate); return; }
  const updates: { preconfigId?: string; selectedVariant?: string | null; agentId?: string | null } = {};
  if (msg.preconfigId !== undefined) {
    updates.preconfigId = msg.preconfigId;
    const preconfig = await getPreconfigOrAgent(msg.preconfigId);
    if (preconfig?.variant) {
      updates.selectedVariant = preconfig.variant;
    } else {
      updates.selectedVariant = null;
    }
    updates.agentId = isAgentSync(msg.preconfigId) ? msg.preconfigId : null;
  }
  const updated = updateSession(msg.sessionId, updates);
  ctx.send(ws, { type: 'session.updated', session: updated! });
}

export function handleUpdateModelSession(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: SessionUpdateModelMessage,
): void {
  const session = getSession(msg.sessionId);
  if (!session) {
    ctx.send(ws, { type: 'error', code: 'not_found', message: 'Session not found' });
    return;
  }
  const gate = checkControllerGate(msg.sessionId, 'session.update_model', ws);
  if (gate) { sendGateRejection(ctx, ws, gate); return; }
  const updated = updateSession(msg.sessionId, {
    selectedModel: msg.modelId,
    selectedProvider: msg.providerId,
    selectedVariant: msg.variant || null,
  });
  ctx.send(ws, { type: 'session.updated', session: updated! });
}

export function handleCloseSession(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: SessionCloseMessage,
): void {
  updateSession(msg.sessionId, { status: 'closed' });
  ctx.send(ws, { type: 'session.closed', sessionId: msg.sessionId });
}

export function handleReopenSession(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: SessionReopenMessage,
): void {
  const session = getSession(msg.sessionId);
  if (!session) {
    ctx.send(ws, { type: 'error', code: 'not_found', message: 'Session not found' });
    return;
  }
  const updated = updateSession(msg.sessionId, { status: 'active' });
  ctx.send(ws, { type: 'session.reopened', session: updated! });
}

export function handleDeleteSession(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: SessionDeleteMessage,
): void {
  try {
    const session = getSession(msg.sessionId);
    if (!session) {
      ctx.send(ws, { type: 'error', code: 'not_found', message: 'Session not found', sessionId: msg.sessionId });
      return;
    }
    deleteSession(msg.sessionId);
    ctx.send(ws, { type: 'session.deleted', sessionId: msg.sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Delete failed';
    ctx.send(ws, { type: 'error', code: 'delete_error', message, sessionId: msg.sessionId });
  }
}

export function handleRenameSession(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: SessionRenameMessage,
): void {
  try {
    const session = getSession(msg.sessionId);
    if (!session) {
      ctx.send(ws, { type: 'error', code: 'not_found', message: 'Session not found', sessionId: msg.sessionId });
      return;
    }
    const trimmedTitle = msg.title?.trim() ?? '';
    if (!trimmedTitle) {
      ctx.send(ws, { type: 'error', code: 'invalid_title', message: 'Title cannot be empty', sessionId: msg.sessionId });
      return;
    }
    const updatedSession = updateSession(msg.sessionId, {
      title: trimmedTitle,
      metadata: markManualSessionTitle(session.metadata),
    });
    ctx.broadcastToSession(msg.sessionId, { type: 'session.renamed', session: updatedSession! });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Rename failed';
    ctx.send(ws, { type: 'error', code: 'rename_error', message, sessionId: msg.sessionId });
  }
}

export function handleGenerateTitleSession(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: SessionGenerateTitleMessage,
): void {
  const session = getSession(msg.sessionId);
  if (!session) {
    ctx.send(ws, { type: 'error', code: 'not_found', message: 'Session not found', sessionId: msg.sessionId });
    return;
  }
  void regenerateSessionTitle(ctx, ws, msg.sessionId, { force: true });
}

export async function handleInterruptSession(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: SessionInterruptMessage,
): Promise<void> {
  const session = getSession(msg.sessionId);
  if (!session) {
    ctx.send(ws, { type: 'error', code: 'not_found', message: 'Session not found' });
    return;
  }
  const gate = checkControllerGate(msg.sessionId, 'session.interrupt', ws);
  if (gate) { sendGateRejection(ctx, ws, gate); return; }

  try {
    const result = await interruptManager.interruptSession(msg.sessionId, msg.reason || 'user_request');
    ctx.broadcastToSession(msg.sessionId, { type: 'session.interrupted', sessionId: msg.sessionId, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Interrupt failed';
    ctx.send(ws, { type: 'error', code: 'interrupt_error', message });
  }
}
