import type { AssistantMessage, ResponseFormat } from '@prokopai/sdk/types';
import {
  emitRuntimeEvent,
  emitSessionUpdated,
  generateSessionTitle,
  hasManualSessionTitle,
  isDefaultSessionTitle,
  isSandboxActive,
  emitTerminal,
  resolveSessionWorkspace,
} from '@/infrastructure/runtime/host-dependencies';
import { getDefaultPreconfig, getPreconfigOrAgent } from '@/harnesses/prokop/context/sources';
import {
  addMessageToQueue,
  buildEffectiveContextHistory,
  createMessage,
  createPart,
  deleteQueuedMessage,
  getAttachment,
  getMessage,
  getNextQueuedMessage,
  getPartsByMessage,
  getResponseFormat,
  getSession,
  getWorkspace,
  listLatestMessagesWithPartsPage,
  listMessagesWithParts,
  updateMessage,
  updatePart,
  updateSession,
} from '@/infrastructure/storage/runtime';
import type { AskBroadcastFn } from '@/infrastructure/runtime/host';
import type { RuntimeDelivery, RuntimeEvent, RuntimeEventContext } from '@/infrastructure/runtime/events';
import { getGoalDomain } from '@/harnesses/prokop/goals/service';
import { interruptManager } from '@/harnesses/prokop/execution/interrupt';
import { getApiKeyForProvider } from '@/infrastructure/providers/configuration/runtime';
import { getProvider } from '@/infrastructure/providers/registry';
import { resolveModelId, resolveProviderId } from '@/infrastructure/providers/model-selection';
import { revertToStep } from '@/harnesses/prokop/execution/revert';
import { streamChatWithRetry } from '@/harnesses/prokop/retry/stream-chat';

export type RuntimeRequestContext<Origin = unknown> = RuntimeEventContext<Origin>;

function deliver<Origin>(ctx: RuntimeRequestContext<Origin>, audience: RuntimeDelivery<Origin>['audience'], event: RuntimeEvent): void {
  const delivery: RuntimeDelivery<Origin> = { audience, event };
  ctx.observe?.(delivery);
  ctx.emit(delivery);
}

function deliverToOrigin<Origin>(ctx: RuntimeRequestContext<Origin>, origin: Origin, event: RuntimeEvent): void {
  deliver(ctx, { scope: 'origin', origin }, event);
}

function deliverToSession<Origin>(ctx: RuntimeRequestContext<Origin>, sessionId: string, event: RuntimeEvent): void {
  deliver(ctx, { scope: 'session', sessionId }, event);
}

// ── Chat helpers ───────────────────────────────────────────────

async function drainQueue<Origin>(
  ctx: RuntimeRequestContext<Origin>,
  sessionId: string,
): Promise<{ content: string; attachments?: Array<{ id: string; kind: string }> } | null> {
  const nextMsg = await getNextQueuedMessage(sessionId);

  if (!nextMsg) {
    return null;
  }

  deliverToSession(ctx, sessionId, {
    kind: 'queue',
    action: 'sending',
    sessionId,
    queueId: nextMsg.id,
  });

  await deleteQueuedMessage(nextMsg.id);

  return {
    content: nextMsg.content,
    ...(nextMsg.attachments ? { attachments: nextMsg.attachments } : {}),
  };
}

// ── Chat turn ──────────────────────────────────────────────────

interface ChatTurnResult {
  streamCompleted: boolean;
  interrupted: boolean;
  contextOverflow: boolean;
  isFatal: boolean;
  isQueueDrainable: boolean;
  errorMessage?: string;
  errorCode?: string;
  errorType?: 'rate_limit' | 'server' | 'timeout' | 'auth' | 'context_overflow' | 'invalid_request';
  retryAfterMs?: number;
}

async function runSingleChatTurn<Origin>(
  ctx: RuntimeRequestContext<Origin>,
  origin: Origin,
  sessionId: string,
  content: string,
  preconfig: NonNullable<Awaited<ReturnType<typeof getPreconfigOrAgent>>>,
  modelId: string,
  provider: string,
  workspacePath: string | null | undefined,
  additionalPaths: string[] | undefined,
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  attachments?: Array<{ id: string; kind: string }>,
  responseFormat?: ResponseFormat,
  existingUserMessageId?: string,
  retryAbortController?: AbortController,
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
    await createMessage(userMessage);

    const textPartId = crypto.randomUUID();
    const textPart = {
      id: textPartId,
      messageId: userMsgId,
      createdAt: Date.now(),
      type: 'text' as const,
      text: content,
    };
    await createPart(textPart, sessionId);

    deliverToSession(ctx, sessionId, { kind: 'message', action: 'created', message: userMessage });
    deliverToSession(ctx, sessionId, { kind: 'part', action: 'created', sessionId, part: textPart });
    void regenerateSessionTitle(ctx, origin, sessionId);
  }

  if (attachments && attachments.length > 0) {
    for (const attachment of attachments) {
      const attachmentRecord = await getAttachment(sessionId, attachment.id);
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
        await createPart(imagePart, sessionId);
        deliverToSession(ctx, sessionId, { kind: 'part', action: 'created', sessionId, part: imagePart });
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
        await createPart(filePart, sessionId);
        deliverToSession(ctx, sessionId, { kind: 'part', action: 'created', sessionId, part: filePart });
      }
    }
  }

  const { messages: history } = await buildEffectiveContextHistory(sessionId);

  const askBroadcastFn: AskBroadcastFn = (message) => {
    if (message.type === 'ask.request') {
      const authority = message.authority ?? { visibilityScope: 'controller_only' as const, resolutionMode: 'controller_only' as const };
      deliver(ctx, { scope: 'ask_targets', sessionId, authority }, {
        kind: 'ask',
        action: 'requested',
        sessionId: message.sessionId,
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        ask: message.ask,
        requestId: message.requestId,
        authority: message.authority,
      });
    } else {
      deliver(ctx, { scope: 'controller', sessionId }, {
        kind: 'ask',
        action: 'timed_out',
        sessionId: message.sessionId,
        toolCallId: message.toolCallId,
        requestId: message.requestId,
      });
    }
  };

  let retryCancelled = false;
  let terminalMessage: AssistantMessage | undefined;
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
      retryAbortController,
    })) {
      switch (event.type) {
        case 'message.created':
          deliverToSession(ctx, sessionId, { kind: 'message', action: 'created', message: event.message });
          break;

        case 'message.updated':
          updateMessage(event.message.id, event.message, { syncFts: false });
          if (event.message.role === 'assistant' && event.message.mode !== 'retry_failed') {
            terminalMessage = event.message;
            if (!event.continuation) emitTerminal(event.message, sessionId);
          }
          deliverToSession(ctx, sessionId, { kind: 'message', action: 'updated', message: event.message });
          break;

        case 'part.created':
          deliverToSession(ctx, sessionId, { kind: 'part', action: 'created', sessionId, part: event.part });
          break;

        case 'part.updated':
          deliverToSession(ctx, sessionId, { kind: 'part', action: 'updated', sessionId, part: event.part });
          break;

        case 'part.append':
          deliverToSession(ctx, sessionId, {
            kind: 'part',
            action: 'append',
            sessionId,
            partId: event.partId,
            field: event.field,
            delta: event.delta,
          });
          break;

        case 'usage': {
          deliverToSession(ctx, sessionId, {
            kind: 'usage',
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

        case 'chat.retry':
          deliverToSession(ctx, sessionId, {
            kind: 'retry',
            sessionId: event.sessionId,
            status: event.status,
            attempt: event.retryNumber,
            maxAttempts: event.maxRetries,
            errorType: event.errorType,
            message: event.message,
            delayMs: event.delayMs,
            retryAt: event.retryAt,
          });
          if (event.status === 'cancelled') {
            retryCancelled = true;
          }
          break;

        case 'error.rate_limit':
          deliverToOrigin(ctx, origin, {
            kind: 'failure',
            category: 'rate_limit',
            code: 'rate_limit',
            message: event.message,
            retryAfterMs: event.retryAfterMs,
            sessionId,
          });
          return {
            streamCompleted: false,
            interrupted: false,
            contextOverflow: false,
            isFatal: true,
            isQueueDrainable: false,
            errorMessage: event.message,
            errorType: 'rate_limit',
            retryAfterMs: event.retryAfterMs,
          };

        case 'error.server':
          deliverToOrigin(ctx, origin, {
            kind: 'failure',
            category: 'server',
            code: 'server_error',
            message: event.message,
            retryAfterMs: event.retryAfterMs,
            sessionId,
          });
          return {
            streamCompleted: false,
            interrupted: false,
            contextOverflow: false,
            isFatal: false,
            isQueueDrainable: true,
            errorMessage: event.message,
            errorType: 'server',
            retryAfterMs: event.retryAfterMs,
          };

        case 'error.timeout':
          deliverToOrigin(ctx, origin, {
            kind: 'failure',
            category: 'timeout',
            code: 'timeout',
            message: event.message,
            retryAfterMs: event.retryAfterMs,
            sessionId,
          });
          return {
            streamCompleted: false,
            interrupted: false,
            contextOverflow: false,
            isFatal: false,
            isQueueDrainable: true,
            errorMessage: event.message,
            errorType: 'timeout',
            retryAfterMs: event.retryAfterMs,
          };

        case 'error':
          deliverToOrigin(ctx, origin, {
            kind: 'failure',
            category: 'generic',
            code: event.code,
            message: event.message,
            sessionId,
          });
          return {
            streamCompleted: false,
            interrupted: false,
            contextOverflow: false,
            isFatal: true,
            isQueueDrainable: false,
            errorMessage: event.message,
            errorType: 'server',
          };

        case 'error.auth':
          deliverToOrigin(ctx, origin, {
            kind: 'failure',
            category: 'generic',
            code: 'authentication',
            message: event.message,
          });
          return {
            streamCompleted: false,
            interrupted: false,
            contextOverflow: false,
            isFatal: true,
            isQueueDrainable: false,
            errorMessage: event.message,
            errorType: 'auth',
          };

        case 'error.context_overflow': {
          deliverToOrigin(ctx, origin, {
            kind: 'failure', category: 'generic', code: 'context_overflow',
            message: event.message, sessionId,
          });
          return {
            streamCompleted: false,
            interrupted: false,
            contextOverflow: true,
            isFatal: false,
            isQueueDrainable: false,
            errorMessage: event.message,
            errorType: 'context_overflow',
          };
        }

        case 'error.invalid_request':
          deliverToOrigin(ctx, origin, {
            kind: 'failure',
            category: 'generic',
            code: 'invalid_request',
            message: event.message,
          });
          return {
            streamCompleted: false,
            interrupted: false,
            contextOverflow: false,
            isFatal: true,
            isQueueDrainable: false,
            errorMessage: event.message,
            errorType: 'invalid_request',
          };
      }
    }

    const wasInterrupted = await (async () => {
      const msgs = await listMessagesWithParts(sessionId);
      const lastAssistant = [...msgs].reverse().find(m => m.message.role === 'assistant');
      return lastAssistant && 'status' in lastAssistant.message
        ? lastAssistant.message.status === 'interrupted'
        : false;
    })();

    return {
      streamCompleted: !retryCancelled,
      interrupted: terminalMessage?.status === 'interrupted' || wasInterrupted || retryCancelled,
      contextOverflow: false,
      isFatal: false,
      isQueueDrainable: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Chat failed';
    console.error('Unexpected chat error:', err);
    deliverToOrigin(ctx, origin, { kind: 'failure', category: 'generic', code: 'chat_error', message });
    return {
      streamCompleted: false,
      interrupted: false,
      contextOverflow: false,
      isFatal: true,
      isQueueDrainable: false,
      errorMessage: message,
      errorType: 'server',
    };
  }
}

export async function regenerateSessionTitle<Origin>(
  ctx: RuntimeRequestContext<Origin>,
  origin: Origin,
  sessionId: string,
  options?: { force?: boolean },
): Promise<void> {
  const session = await getSession(sessionId);
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
    const messages = await listMessagesWithParts(sessionId);
    console.info('[session-title] Generating session title', {
      sessionId,
      force: options?.force === true,
      messageCount: messages.length,
    });
    const title = await generateSessionTitle(messages);
    if (!title) {
      console.warn('[session-title] Skipping title update: no title generated', sessionId);
      deliverToOrigin(ctx, origin, {
        kind: 'failure',
        category: 'generic',
        code: 'title_generation_error',
        message: 'Could not generate a title from the conversation.',
        sessionId,
      });
      return;
    }
    const updated = await updateSession(sessionId, { title });
    if (updated) {
      console.info('[session-title] Updated session title', { sessionId, title });
      deliverToSession(ctx, sessionId, { kind: 'session', action: 'renamed', session: updated });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[session-title] Failed to generate session title', { sessionId, message });
    deliverToOrigin(ctx, origin, {
      kind: 'failure',
      category: 'generic',
      code: 'title_generation_error',
      message: `Title generation failed: ${message}`,
      sessionId,
    });
  }
}

// ── Chat handler ───────────────────────────────────────────────

export async function handleChat<Origin>(
  ctx: RuntimeRequestContext<Origin>,
  origin: Origin,
  sessionId: string,
  content: string,
  attachments?: Array<{ id: string; kind: string }>,
  responseFormatId?: string,
  goalCondition?: string,
  goalMaxTurns?: number,
): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) {
    deliverToOrigin(ctx, origin, { kind: 'failure', category: 'generic', code: 'not_found', message: 'Session not found' });
    return;
  }

  if (session.status === 'closed') {
    deliverToOrigin(ctx, origin, {
      kind: 'failure',
      category: 'generic',
      code: 'session_closed',
      message: 'Cannot send messages to an archived session. Reopen it first.',
    });
    return;
  }

  if (interruptManager.isSessionActive(sessionId)) {
    const queuedMessage = await addMessageToQueue(sessionId, content, attachments);
    ctx.attachOriginToSession(origin, sessionId);
    deliverToOrigin(ctx, origin, { kind: 'queue', action: 'added', sessionId, message: queuedMessage });
    return;
  }

  const workspace = session.workspaceId ? await getWorkspace(session.workspaceId) : null;
  const workspaceContext = await resolveSessionWorkspace({
    sessionId,
    workspaceId: session.workspaceId || undefined,
    workspaceRootId: session.workspaceRootId ?? undefined,
    workspacePath: workspace?.path,
    additionalPaths: workspace?.additionalPaths,
  });
  const workspacePath = workspaceContext.workspacePath;
  const additionalPaths = workspaceContext.additionalPaths;

  const preconfig = session.preconfigId
    ? await getPreconfigOrAgent(session.preconfigId)
    : await getDefaultPreconfig();

  if (!preconfig) {
    deliverToOrigin(ctx, origin, { kind: 'failure', category: 'generic', code: 'no_preconfig', message: 'No preconfig found' });
    return;
  }

  const modelId = resolveModelId(session, preconfig);
  const provider = resolveProviderId(session, preconfig);

  const apiKey = getApiKeyForProvider(provider);

  const isConnectableProvider = getProvider(provider) !== undefined;
  if (!apiKey && !isConnectableProvider) {
    deliverToOrigin(ctx, origin, {
      kind: 'failure',
      category: 'generic',
      code: 'no_api_key',
      message: `No API key configured for provider: ${provider}. Register the provider or configure its API key in runtime configuration.`,
    });
    return;
  }

  const responseFormatRecord = responseFormatId ? await getResponseFormat(responseFormatId) : null;
  const responseFormat = responseFormatRecord ?? undefined;

  if (goalCondition) {
    const goalAbortController = interruptManager.registerSession(sessionId, session.parentId ?? undefined);

    let firstGoalTurn = true;
    try {
      const running = await updateSession(sessionId, { runningAt: new Date().toISOString() });
      if (running) emitSessionUpdated(running);
      await getGoalDomain().runGoalLoop({
        sessionId,
        condition: goalCondition,
        initialPrompt: content,
        maxTurns: goalMaxTurns,
        abortSignal: goalAbortController.signal,
        broadcast: emitRuntimeEvent,
        runTurn: async (turnContent: string) => {
          const result = await runSingleChatTurn(
            ctx, origin, sessionId, turnContent, preconfig, modelId, provider,
            workspacePath, additionalPaths, session, firstGoalTurn ? attachments : undefined, responseFormat,
            undefined, goalAbortController,
          );
          firstGoalTurn = false;
          return {
            streamCompleted: result.streamCompleted,
            interrupted: result.interrupted,
          };
        },
      });
    } finally {
      interruptManager.unregisterSession(sessionId);
      const stopped = await updateSession(sessionId, { runningAt: null });
      if (stopped) emitSessionUpdated(stopped);
    }
    return;
  }

  let currentContent: string = content;
  let currentAttachments: Array<{ id: string; kind: string }> | undefined = attachments;

  while (true) {
    const result = await runSingleChatTurn(
      ctx,
      origin,
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

    if (result.contextOverflow) return;


    if (result.isFatal) {
      return;
    }

    if (result.interrupted) {
      // The old turn has finished cleanup; queued input starts a fresh turn.
      const next = await drainQueue(ctx, sessionId);
      if (!next) {
        return;
      }
      currentContent = next.content;
      currentAttachments = next.attachments;
      continue;
    }

    if (result.isQueueDrainable) {
      const next = await drainQueue(ctx, sessionId);
      if (next) {
        currentContent = next.content;
        currentAttachments = next.attachments;
        continue;
      }
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

export async function handleSessionEditMessage<Origin>(
  ctx: RuntimeRequestContext<Origin>,
  origin: Origin,
  msg: { sessionId: string; messageId: string; content: string },
): Promise<void> {
  try {
    const session = await getSession(msg.sessionId);
    if (!session) {
      deliverToOrigin(ctx, origin, {
        kind: 'failure',
        category: 'generic',
        code: 'not_found',
        message: 'Session not found',
        sessionId: msg.sessionId,
      });
      return;
    }

    if (session.status === 'closed') {
      deliverToOrigin(ctx, origin, {
        kind: 'failure',
        category: 'generic',
        code: 'session_closed',
        message: 'Cannot edit messages in an archived session.',
        sessionId: msg.sessionId,
      });
      return;
    }

    if (interruptManager.isSessionActive(msg.sessionId)) {
      deliverToOrigin(ctx, origin, {
        kind: 'failure',
        category: 'generic',
        code: 'session_busy',
        message: 'Cannot edit while the session is streaming.',
        sessionId: msg.sessionId,
      });
      return;
    }

    const target = await getMessage(msg.messageId);
    if (!target || target.sessionId !== msg.sessionId || target.role !== 'user') {
      deliverToOrigin(ctx, origin, {
        kind: 'failure',
        category: 'generic',
        code: 'invalid_message',
        message: 'Only user messages can be edited.',
        sessionId: msg.sessionId,
      });
      return;
    }

    const parts = await getPartsByMessage(msg.messageId);
    const textPart = parts.find((p) => p.type === 'text');
    if (!textPart || textPart.type !== 'text') {
      deliverToOrigin(ctx, origin, {
        kind: 'failure',
        category: 'generic',
        code: 'invalid_message',
        message: 'Message has no editable text.',
        sessionId: msg.sessionId,
      });
      return;
    }
    const updatedPart = await updatePart(textPart.id, { text: msg.content });
    if (updatedPart) {
      deliverToSession(ctx, msg.sessionId, {
        kind: 'part',
        action: 'updated',
        sessionId: msg.sessionId,
        part: updatedPart,
      });
    }

    await revertToStep({
      sessionId: msg.sessionId,
      targetMessageId: msg.messageId,
      keepTarget: true,
    });

    const currentState = await listLatestMessagesWithPartsPage(msg.sessionId, 50);
    deliverToSession(ctx, msg.sessionId, {
      kind: 'session',
      action: 'state',
      sessionId: msg.sessionId,
      messages: currentState.messages,
    });

    const workspace = session.workspaceId ? await getWorkspace(session.workspaceId) : null;
    const workspaceContext = await resolveSessionWorkspace({
      sessionId: msg.sessionId,
      workspaceId: session.workspaceId || undefined,
      workspaceRootId: session.workspaceRootId ?? undefined,
      workspacePath: workspace?.path,
      additionalPaths: workspace?.additionalPaths,
    });
    const workspacePath = workspaceContext.workspacePath;
    const additionalPaths = workspaceContext.additionalPaths;

    const preconfig = session.preconfigId
      ? await getPreconfigOrAgent(session.preconfigId)
      : await getDefaultPreconfig();
    if (!preconfig) {
      deliverToOrigin(ctx, origin, {
        kind: 'failure',
        category: 'generic',
        code: 'no_preconfig',
        message: 'No preconfig found',
        sessionId: msg.sessionId,
      });
      return;
    }

    const modelId = resolveModelId(session, preconfig);
    const provider = resolveProviderId(session, preconfig);

    await runSingleChatTurn(
      ctx,
      origin,
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
    deliverToOrigin(ctx, origin, {
      kind: 'failure',
      category: 'generic',
      code: 'edit_error',
      message,
      sessionId: msg.sessionId,
    });
  }
}
