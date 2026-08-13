import type { AskAuthority, ServerMessage } from '@jean2/sdk';
import {
  addMessageToQueue,
  buildEffectiveContextHistory,
  createMessage,
  createPart,
  deleteQueuedMessage,
  generateSessionTitle,
  getAttachment,
  getDefaultPreconfig,
  getMessage,
  getNextQueuedMessage,
  getPartsByMessage,
  getPreconfigOrAgent,
  getProvider,
  getResponseFormat,
  getSession,
  getWorkspace,
  hasManualSessionTitle,
  isDefaultSessionTitle,
  isSandboxActive,
  listLatestMessagesWithPartsPage,
  listMessagesWithParts,
  notifyTerminalMessage,
  updateMessage,
  updatePart,
  updateSession,
} from '../compat/jean2-dependencies';
import type { AskBroadcastFn } from '../compat/bindings';
import { executeCompaction } from './compaction-executor';
import { runGoalLoop } from './goal-loop';
import { interruptManager } from './interrupt';
import { getApiKeyForProvider, resolveModelId, resolveProviderId } from './provider-utils';
import { revertToStep } from './revert';
import { streamChatWithRetry } from './retry';

export interface Jean2RouterClientEntry {
  sessionIds: Set<string>;
  missedPings: number;
}

export interface Jean2RouterContext<WebSocket = unknown> {
  send: (ws: WebSocket, msg: ServerMessage) => void;
  broadcast: (message: ServerMessage, excludeWs?: WebSocket) => void;
  broadcastToSession: (sessionId: string, message: ServerMessage, excludeWs?: WebSocket) => void;
  sendToController: (sessionId: string, message: ServerMessage) => void;
  sendToAskTargets: (sessionId: string, authority: AskAuthority, message: ServerMessage) => void;
  clients: Map<WebSocket, Jean2RouterClientEntry>;
}

// ── Compaction failure tracking ────────────────────────────────

const compactionFailureTracker = new Map<string, { count: number; lastFailureAt: number }>();
const COMPACTION_FAILURE_COOLDOWN_MS = 60_000;
const COMPACTION_MAX_CONSECUTIVE_FAILURES = 2;

function shouldSkipCompaction(sessionId: string): boolean {
  const tracker = compactionFailureTracker.get(sessionId);
  if (!tracker) return false;

  const elapsed = Date.now() - tracker.lastFailureAt;
  if (elapsed > COMPACTION_FAILURE_COOLDOWN_MS) {
    compactionFailureTracker.delete(sessionId);
    return false;
  }

  return tracker.count >= COMPACTION_MAX_CONSECUTIVE_FAILURES;
}

function recordCompactionFailure(sessionId: string): void {
  const existing = compactionFailureTracker.get(sessionId);
  if (existing) {
    existing.count++;
    existing.lastFailureAt = Date.now();
  } else {
    compactionFailureTracker.set(sessionId, { count: 1, lastFailureAt: Date.now() });
  }
}

function clearCompactionFailure(sessionId: string): void {
  compactionFailureTracker.delete(sessionId);
}

// ── Chat helpers ───────────────────────────────────────────────

function findReplayText(sessionId: string): string | null {
  const allMessages = listMessagesWithParts(sessionId);

  for (let i = allMessages.length - 2; i >= 0; i--) {
    const m = allMessages[i];
    if (m.message.role !== 'user') continue;
    if (m.parts.every((p) => p.type === 'compaction')) continue;

    const texts: string[] = [];
    for (const p of m.parts) {
      if (p.type === 'text' && p.text !== undefined) {
        if (!p.text.startsWith('Continue:') && !p.text.startsWith('Continue from')) {
          texts.push(p.text);
        }
      }
    }
    const text = texts.join(' ').trim();
    if (text) {
      return `Replay: ${text}`;
    }
  }

  return null;
}

async function drainQueue<WebSocket>(
  ctx: Jean2RouterContext<WebSocket>,
  sessionId: string,
): Promise<{ content: string; attachments?: Array<{ id: string; kind: string }> } | null> {
  const nextMsg = getNextQueuedMessage(sessionId);

  if (!nextMsg) {
    return null;
  }

  ctx.broadcastToSession(sessionId, {
    type: 'queue.sending',
    sessionId,
    queueId: nextMsg.id,
  });

  deleteQueuedMessage(nextMsg.id);

  return {
    content: nextMsg.content,
    ...(nextMsg.attachments ? { attachments: nextMsg.attachments } : {}),
  };
}

// ── Chat turn ──────────────────────────────────────────────────

interface ChatTurnResult {
  streamCompleted: boolean;
  interrupted: boolean;
  needsAutoCompaction: boolean;
  contextOverflow: boolean;
  isFatal: boolean;
  isQueueDrainable: boolean;
  errorMessage?: string;
  errorCode?: string;
  errorType?: 'rate_limit' | 'server' | 'timeout' | 'auth' | 'context_overflow' | 'invalid_request';
  retryAfterMs?: number;
}

async function runSingleChatTurn<WebSocket>(
  ctx: Jean2RouterContext<WebSocket>,
  ws: WebSocket,
  sessionId: string,
  content: string,
  preconfig: NonNullable<Awaited<ReturnType<typeof getPreconfigOrAgent>>>,
  modelId: string,
  provider: string,
  workspacePath: string | null | undefined,
  additionalPaths: string[] | undefined,
  session: NonNullable<ReturnType<typeof getSession>>,
  attachments?: Array<{ id: string; kind: string }>,
  responseFormat?: import('@jean2/sdk').ResponseFormat,
  existingUserMessageId?: string,
): Promise<ChatTurnResult> {
  let userMsgId: string;

  if (existingUserMessageId) {
    userMsgId = existingUserMessageId;
  } else {
    userMsgId = crypto.randomUUID();

    const userMessage = {
      id: userMsgId,
      sessionId,
      role: 'user' as const,
      createdAt: Date.now(),
    };
    createMessage(userMessage);

    const textPartId = crypto.randomUUID();
    const textPart = {
      id: textPartId,
      messageId: userMsgId,
      createdAt: Date.now(),
      type: 'text' as const,
      text: content,
    };
    createPart(textPart, sessionId);

    ctx.broadcastToSession(sessionId, { type: 'message.created', message: userMessage });
    ctx.broadcastToSession(sessionId, { type: 'part.created', sessionId, part: textPart });
    void regenerateSessionTitle(ctx, ws, sessionId);
  }

  if (attachments && attachments.length > 0) {
    for (const attachment of attachments) {
      const attachmentRecord = getAttachment(sessionId, attachment.id);
      if (!attachmentRecord) continue;

      const partId = crypto.randomUUID();
      const serverUrl = `/api/sessions/${sessionId}/attachments/${attachmentRecord.id}/content?key=${attachmentRecord.accessKey}`;

      if (attachmentRecord.kind === 'image') {
        const imagePart = {
          id: partId,
          messageId: userMsgId,
          createdAt: Date.now(),
          type: 'image' as const,
          url: serverUrl,
          mimeType: attachmentRecord.mimeType,
        };
        createPart(imagePart, sessionId);
        ctx.broadcastToSession(sessionId, { type: 'part.created', sessionId, part: imagePart });
      } else {
        const filePart = {
          id: partId,
          messageId: userMsgId,
          createdAt: Date.now(),
          type: 'file' as const,
          url: serverUrl,
          mimeType: attachmentRecord.mimeType,
          filename: attachmentRecord.filename,
        };
        createPart(filePart, sessionId);
        ctx.broadcastToSession(sessionId, { type: 'part.created', sessionId, part: filePart });
      }
    }
  }

  const { messages: history } = buildEffectiveContextHistory(sessionId);

  const askBroadcastFn: AskBroadcastFn = (message) => {
    if (message.type === 'ask.request') {
      const authority = message.authority ?? { visibilityScope: 'controller_only' as const, resolutionMode: 'controller_only' as const };
      ctx.sendToAskTargets(sessionId, authority, message as ServerMessage);
    } else if (message.type === 'ask.timeout') {
      ctx.sendToController(sessionId, message as ServerMessage);
    } else {
      ctx.broadcast(message as ServerMessage);
    }
  };

  let pendingCompaction = false;
  let retryCancelled = false;
  const effectiveProvider = isSandboxActive() ? 'sandbox' : provider;

  try {
    for await (const event of streamChatWithRetry({
      sessionId,
      preconfig,
      messages: history,
      modelId: modelId,
      providerId: effectiveProvider,
      variant: session.selectedVariant || undefined,
      workspacePath: workspacePath ?? undefined,
      workspaceId: session.workspaceId || undefined,
      additionalPaths,
      broadcastFn: askBroadcastFn,
      responseFormat,
    })) {
      switch (event.type) {
        case 'message.created':
          ctx.broadcastToSession(sessionId, event);
          break;

        case 'message.updated':
          updateMessage(event.message.id, event.message, { syncFts: false });
          if (event.message.role === 'assistant' && event.message.mode !== 'retry_failed') {
            notifyTerminalMessage(event.message, sessionId);
          }
          ctx.broadcastToSession(sessionId, event);
          break;

        case 'part.created':
          ctx.broadcastToSession(sessionId, event);
          break;

        case 'part.updated':
          ctx.broadcastToSession(sessionId, event);
          break;

        case 'part.append':
          ctx.broadcastToSession(sessionId, event);
          break;

        case 'usage': {
          ctx.broadcastToSession(sessionId, {
            type: 'chat.usage',
            sessionId,
            usage: event.usage,
            model: event.model,
            variant: event.variant ?? undefined,
          });
          updateSession(sessionId, {
            promptTokens: event.usage.promptTokens,
            completionTokens: event.usage.completionTokens,
            totalTokens: event.usage.totalTokens,
            cacheReadTokens: event.usage.cacheReadTokens,
            cacheWriteTokens: event.usage.cacheWriteTokens,
            noCacheTokens: event.usage.noCacheTokens,
          });
          break;
        }

        case 'needs_compaction':
          pendingCompaction = true;
          break;

        case 'chat.retry':
          ctx.broadcastToSession(sessionId, event);
          if (event.status === 'cancelled') {
            retryCancelled = true;
          }
          break;

        case 'error.rate_limit':
          ctx.send(ws, {
            type: 'error.rate_limit',
            code: 'rate_limit',
            message: event.message,
            retryAfterMs: event.retryAfterMs,
            sessionId,
          });
          return {
            streamCompleted: false,
            interrupted: false,
            needsAutoCompaction: false,
            contextOverflow: false,
            isFatal: true,
            isQueueDrainable: false,
            errorMessage: event.message,
            errorType: 'rate_limit',
            retryAfterMs: event.retryAfterMs,
          };

        case 'error.server':
          ctx.send(ws, {
            type: 'error.server',
            code: 'server_error',
            message: event.message,
            retryAfterMs: event.retryAfterMs,
            sessionId,
          });
          return {
            streamCompleted: false,
            interrupted: false,
            needsAutoCompaction: false,
            contextOverflow: false,
            isFatal: false,
            isQueueDrainable: true,
            errorMessage: event.message,
            errorType: 'server',
            retryAfterMs: event.retryAfterMs,
          };

        case 'error.timeout':
          ctx.send(ws, {
            type: 'error.timeout',
            code: 'timeout',
            message: event.message,
            retryAfterMs: event.retryAfterMs,
            sessionId,
          });
          return {
            streamCompleted: false,
            interrupted: false,
            needsAutoCompaction: false,
            contextOverflow: false,
            isFatal: false,
            isQueueDrainable: true,
            errorMessage: event.message,
            errorType: 'timeout',
            retryAfterMs: event.retryAfterMs,
          };

        case 'error':
          ctx.send(ws, {
            type: 'error',
            code: event.code,
            message: event.message,
            sessionId,
          });
          return {
            streamCompleted: false,
            interrupted: false,
            needsAutoCompaction: false,
            contextOverflow: false,
            isFatal: true,
            isQueueDrainable: false,
            errorMessage: event.message,
            errorType: 'server',
          };

        case 'error.auth':
          ctx.send(ws, {
            type: 'error',
            code: 'authentication',
            message: event.message,
          });
          return {
            streamCompleted: false,
            interrupted: false,
            needsAutoCompaction: false,
            contextOverflow: false,
            isFatal: true,
            isQueueDrainable: false,
            errorMessage: event.message,
            errorType: 'auth',
          };

        case 'error.context_overflow': {
          return {
            streamCompleted: false,
            interrupted: false,
            needsAutoCompaction: false,
            contextOverflow: true,
            isFatal: false,
            isQueueDrainable: false,
            errorMessage: event.message,
            errorType: 'context_overflow',
          };
        }

        case 'error.invalid_request':
          ctx.send(ws, {
            type: 'error',
            code: 'invalid_request',
            message: event.message,
          });
          return {
            streamCompleted: false,
            interrupted: false,
            needsAutoCompaction: false,
            contextOverflow: false,
            isFatal: true,
            isQueueDrainable: false,
            errorMessage: event.message,
            errorType: 'invalid_request',
          };
      }
    }

    const wasInterrupted = (() => {
      const msgs = listMessagesWithParts(sessionId);
      const lastAssistant = [...msgs].reverse().find(m => m.message.role === 'assistant');
      return lastAssistant && 'status' in lastAssistant.message
        ? lastAssistant.message.status === 'interrupted'
        : false;
    })();

    return {
      streamCompleted: !retryCancelled,
      interrupted: wasInterrupted || retryCancelled,
      needsAutoCompaction: pendingCompaction,
      contextOverflow: false,
      isFatal: false,
      isQueueDrainable: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Chat failed';
    console.error('Unexpected chat error:', err);
    ctx.send(ws, { type: 'error', code: 'chat_error', message });
    return {
      streamCompleted: false,
      interrupted: false,
      needsAutoCompaction: false,
      contextOverflow: false,
      isFatal: true,
      isQueueDrainable: false,
      errorMessage: message,
      errorType: 'server',
    };
  }
}

export async function regenerateSessionTitle<WebSocket>(
  ctx: Jean2RouterContext<WebSocket>,
  ws: WebSocket,
  sessionId: string,
  options?: { force?: boolean },
): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    console.warn('[session-title] Skipping title generation: session not found', sessionId);
    return;
  }
  if (!options?.force && (!isDefaultSessionTitle(session.title) || hasManualSessionTitle(session.metadata))) {
    console.info('[session-title] Skipping auto title generation', {
      sessionId,
      title: session.title,
      manuallyRenamed: hasManualSessionTitle(session.metadata),
    });
    return;
  }

  try {
    const messages = listMessagesWithParts(sessionId);
    console.info('[session-title] Generating session title', {
      sessionId,
      force: options?.force === true,
      messageCount: messages.length,
    });
    const title = await generateSessionTitle(messages);
    if (!title) {
      console.warn('[session-title] Skipping title update: no title generated', sessionId);
      ctx.send(ws, { type: 'error', code: 'title_generation_error', message: 'Could not generate a title from the conversation.', sessionId });
      return;
    }
    const updated = updateSession(sessionId, { title });
    if (updated) {
      console.info('[session-title] Updated session title', { sessionId, title });
      ctx.broadcastToSession(sessionId, { type: 'session.renamed', session: updated });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[session-title] Failed to generate session title', { sessionId, message });
    ctx.send(ws, { type: 'error', code: 'title_generation_error', message: `Title generation failed: ${message}`, sessionId });
  }
}

// ── Chat handler ───────────────────────────────────────────────

export async function handleChat<WebSocket>(
  ctx: Jean2RouterContext<WebSocket>,
  ws: WebSocket,
  sessionId: string,
  content: string,
  attachments?: Array<{ id: string; kind: string }>,
  responseFormatId?: string,
  goalCondition?: string,
  goalMaxTurns?: number,
): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    ctx.send(ws, { type: 'error', code: 'not_found', message: 'Session not found' });
    return;
  }

  if (session.status === 'closed') {
    ctx.send(ws, { type: 'error', code: 'session_closed', message: 'Cannot send messages to an archived session. Reopen it first.' });
    return;
  }

  if (interruptManager.isSessionActive(sessionId)) {
    const queuedMessage = addMessageToQueue(sessionId, content, attachments);
    const existingEntry = ctx.clients.get(ws);
    if (existingEntry) {
      existingEntry.sessionIds.add(sessionId);
    } else {
      ctx.clients.set(ws, { sessionIds: new Set([sessionId]), missedPings: 0 });
    }
    ctx.send(ws, { type: 'queue.added', sessionId, message: queuedMessage });
    return;
  }

  const workspace = session.workspaceId ? getWorkspace(session.workspaceId) : null;
  const workspacePath = workspace?.path;
  const additionalPaths = workspace?.additionalPaths;

  const preconfig = session.preconfigId
    ? await getPreconfigOrAgent(session.preconfigId)
    : await getDefaultPreconfig();

  if (!preconfig) {
    ctx.send(ws, { type: 'error', code: 'no_preconfig', message: 'No preconfig found' });
    return;
  }

  const modelId = resolveModelId(session, preconfig);
  const provider = resolveProviderId(session, preconfig);

  const apiKey = getApiKeyForProvider(provider);

  const isConnectableProvider = getProvider(provider) !== undefined;
  if (!apiKey && !isConnectableProvider) {
    const envKey = `JEAN2_LLM_${provider.toUpperCase()}_API_KEY`;
    ctx.send(ws, { type: 'error', code: 'no_api_key', message: `No API key configured for provider: ${provider}. Set ${envKey}` });
    return;
  }

  const responseFormat = responseFormatId ? getResponseFormat(responseFormatId) ?? undefined : undefined;

  if (goalCondition) {
    const goalAbortController = new AbortController();
    const checkInterval = setInterval(() => {
      if (interruptManager.isSessionInterrupted(sessionId) && !goalAbortController.signal.aborted) {
        goalAbortController.abort(new Error('Goal loop cancelled by user'));
      }
    }, 200);

    try {
      await runGoalLoop({
        sessionId,
        condition: goalCondition,
        initialPrompt: content,
        maxTurns: goalMaxTurns,
        abortSignal: goalAbortController.signal,
        broadcast: ctx.broadcast,
        runTurn: async (turnContent: string) => {
          const result = await runSingleChatTurn(
            ctx, ws, sessionId, turnContent, preconfig, modelId, provider,
            workspacePath, additionalPaths, session, undefined, responseFormat,
          );
          return {
            streamCompleted: result.streamCompleted,
            interrupted: result.interrupted,
          };
        },
      });
    } finally {
      clearInterval(checkInterval);
    }
    return;
  }

  let currentContent: string = content;
  let currentAttachments: Array<{ id: string; kind: string }> | undefined = attachments;
  let overflowRetryDepth = 0;

  while (true) {
    const result = await runSingleChatTurn(
      ctx,
      ws,
      sessionId,
      currentContent,
      preconfig,
      modelId,
      provider,
      workspacePath,
      additionalPaths,
      session,
      currentAttachments,
      responseFormat,
    );

    if (result.contextOverflow) {
      if (overflowRetryDepth >= 1) {
        ctx.send(ws, { type: 'error', code: 'context_overflow', message: result.errorMessage ?? 'Context overflow' });
        return;
      }

      const currentSession = getSession(sessionId);
      const isMainSession = currentSession && !currentSession.parentId;

      if (isMainSession && !shouldSkipCompaction(sessionId)) {
        const replayText = findReplayText(sessionId);
        const execResult = await executeCompaction(sessionId, 'overflow');

        if (execResult.ok) {
          clearCompactionFailure(sessionId);
          overflowRetryDepth++;
          currentContent = replayText ?? 'Continue from where we left off, using the compacted context.';
          continue;
        } else if (!execResult.skipped) {
          recordCompactionFailure(sessionId);
          console.warn(`[handleChat] Overflow compaction failed for session ${sessionId}: ${execResult.error}`);
        }
      }

      ctx.send(ws, { type: 'error', code: 'context_overflow', message: result.errorMessage ?? 'Context overflow' });
      return;
    }

    if (result.isFatal || result.interrupted) {
      return;
    }

    if (result.isQueueDrainable) {
      const next = await drainQueue(ctx, sessionId);
      if (next) {
        currentContent = next.content;
        currentAttachments = next.attachments;
        continue;
      }
    }

    if (result.streamCompleted && result.needsAutoCompaction) {
      const currentSession = getSession(sessionId);
      if (currentSession && !currentSession.parentId && !shouldSkipCompaction(sessionId)) {
        const execResult = await executeCompaction(sessionId, 'auto');
        if (execResult.ok) {
          clearCompactionFailure(sessionId);
        } else if (!execResult.skipped) {
          recordCompactionFailure(sessionId);
          console.warn(`[handleChat] Auto-compaction failed for session ${sessionId}: ${execResult.error}`);
        }
      }
      const next = await drainQueue(ctx, sessionId);
      if (next) {
        currentContent = next.content;
        currentAttachments = next.attachments;
        continue;
      }
      return;
    }

    if (result.streamCompleted) {
      const next = await drainQueue(ctx, sessionId);
      if (next) {
        currentContent = next.content;
        currentAttachments = next.attachments;
        continue;
      }
      return;
    }

    return;
  }
}

export async function handleSessionEditMessage<WebSocket>(
  ctx: Jean2RouterContext<WebSocket>,
  ws: WebSocket,
  msg: { sessionId: string; messageId: string; content: string },
): Promise<void> {
  try {
    const session = getSession(msg.sessionId);
    if (!session) {
      ctx.send(ws, { type: 'error', code: 'not_found', message: 'Session not found', sessionId: msg.sessionId });
      return;
    }

    if (session.status === 'closed') {
      ctx.send(ws, { type: 'error', code: 'session_closed', message: 'Cannot edit messages in an archived session.', sessionId: msg.sessionId });
      return;
    }

    if (interruptManager.isSessionActive(msg.sessionId)) {
      ctx.send(ws, { type: 'error', code: 'session_busy', message: 'Cannot edit while the session is streaming.', sessionId: msg.sessionId });
      return;
    }

    const target = getMessage(msg.messageId);
    if (!target || target.sessionId !== msg.sessionId || target.role !== 'user') {
      ctx.send(ws, { type: 'error', code: 'invalid_message', message: 'Only user messages can be edited.', sessionId: msg.sessionId });
      return;
    }

    const parts = getPartsByMessage(msg.messageId);
    const textPart = parts.find((p) => p.type === 'text');
    if (!textPart || textPart.type !== 'text') {
      ctx.send(ws, { type: 'error', code: 'invalid_message', message: 'Message has no editable text.', sessionId: msg.sessionId });
      return;
    }
    const updatedPart = updatePart(textPart.id, { text: msg.content });
    if (updatedPart) {
      ctx.broadcastToSession(msg.sessionId, {
        type: 'part.updated',
        sessionId: msg.sessionId,
        part: updatedPart,
      });
    }

    await revertToStep({
      sessionId: msg.sessionId,
      targetMessageId: msg.messageId,
      keepTarget: true,
    });

    const currentState = listLatestMessagesWithPartsPage(msg.sessionId, 50);
    ctx.broadcastToSession(msg.sessionId, {
      type: 'session.state',
      sessionId: msg.sessionId,
      messages: currentState.messages,
    });

    const workspace = session.workspaceId ? getWorkspace(session.workspaceId) : null;
    const workspacePath = workspace?.path;
    const additionalPaths = workspace?.additionalPaths;

    const preconfig = session.preconfigId
      ? await getPreconfigOrAgent(session.preconfigId)
      : await getDefaultPreconfig();
    if (!preconfig) {
      ctx.send(ws, { type: 'error', code: 'no_preconfig', message: 'No preconfig found', sessionId: msg.sessionId });
      return;
    }

    const modelId = resolveModelId(session, preconfig);
    const provider = resolveProviderId(session, preconfig);

    await runSingleChatTurn(
      ctx,
      ws,
      msg.sessionId,
      msg.content,
      preconfig,
      modelId,
      provider,
      workspacePath,
      additionalPaths,
      session,
      undefined,
      undefined,
      msg.messageId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Edit failed';
    ctx.send(ws, { type: 'error', code: 'edit_error', message, sessionId: msg.sessionId });
  }
}
