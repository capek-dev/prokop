import { randomUUID } from 'crypto';
import type { MessageWithParts, Part, TextPart, Preconfig, UserMessage, ResponseFormat, StructuredOutputData } from '@capekai/types';
import {
  emitRuntimeEvent,
  emitTerminal,
  emitToAskTargets,
  emitToController,
} from '../runtime/host-dependencies';
import { getLLMSubagentMaxSteps } from '../configuration/runtime';
import {
  buildEffectiveContextHistory,
  createMessage,
  createPart,
  getSession,
  getWorkspace,
  updateMessage,
  updateSession,
} from '../storage/runtime';
import type { AskBroadcastFn, BroadcastFn } from '../runtime/host';
import { classifyApiError } from '../utils/errors';
import { streamChatWithRetry } from '../retry/stream-chat';

export async function executeChildSession(options: {
  parentSessionId: string;
  childSessionId: string;
  preconfig: Preconfig;
  prompt: string;
  workspacePath?: string;
  workspaceId?: string;
  resumeFromHistory?: boolean;
  modelId?: string | null;
  providerId?: string | null;
  variant?: string | null;
  broadcast?: BroadcastFn;
  broadcastToSession?: BroadcastFn;
  /** Optional response format for structured subagent output */
  responseFormat?: ResponseFormat;
  abortSignal?: AbortSignal;
  streamChat?: typeof streamChatWithRetry;
}): Promise<{
  parts: Part[];
  error?: string;
  structuredOutput?: StructuredOutputData;
}> {
  const {
    childSessionId,
    preconfig,
    prompt,
    workspacePath,
    workspaceId,
    resumeFromHistory,
    modelId,
    providerId,
    variant,
    broadcast: broadcastFn = emitRuntimeEvent,
    broadcastToSession: broadcastToSessionFn = broadcastFn,
    responseFormat,
    abortSignal,
    streamChat = streamChatWithRetry,
  } = options;

  // Resolve additionalPaths from workspace
  const workspace = workspaceId ? await getWorkspace(workspaceId) : null;
  const additionalPaths = workspace?.additionalPaths;

  let messages: MessageWithParts[];

  if (resumeFromHistory) {
    // Load full history with parts (same function handleChat uses)
    const { messages: historyMessages } = await buildEffectiveContextHistory(childSessionId);

    // Create the new user message
    const newMsgId = randomUUID();
    const newMessage: UserMessage = {
      id: newMsgId,
      sessionId: childSessionId,
      role: 'user',
      createdAt: Date.now(),
    };
    const textPart: TextPart = {
      id: randomUUID(),
      messageId: newMsgId,
      createdAt: Date.now(),
      type: 'text',
      text: prompt,
    };
    messages = [...historyMessages, { message: newMessage, parts: [textPart] }];
    await createMessage(newMessage);
    await createPart(textPart, childSessionId);
  } else {
    const msgId = randomUUID();
    const userMessage: UserMessage = {
      id: msgId,
      sessionId: childSessionId,
      role: 'user',
      createdAt: Date.now(),
    };
    const textPart: TextPart = {
      id: randomUUID(),
      messageId: msgId,
      createdAt: Date.now(),
      type: 'text',
      text: prompt,
    };
    messages = [{ message: userMessage, parts: [textPart] }];
    await createMessage(userMessage);
    await createPart(textPart, childSessionId);
  }

  const finalParts: Part[] = [];
  let error: string | undefined;
  let structuredOutput: StructuredOutputData | undefined;
  const retryAbortController = new AbortController();
  const abortHandler = () => retryAbortController.abort(abortSignal?.reason);
  if (abortSignal?.aborted) {
    abortHandler();
  } else {
    abortSignal?.addEventListener('abort', abortHandler, { once: true });
  }

  async function findRootSessionId(sessionId: string): Promise<string> {
    let current = sessionId;
    let session = await getSession(current);
    while (session?.parentId) {
      current = session.parentId;
      session = await getSession(current);
    }
    return current;
  }

  const rootSessionId = await findRootSessionId(childSessionId);

  const askBroadcastFn: AskBroadcastFn = (message) => {
    // Route permission asks to the root session so the user always sees them
    if (message.type === 'ask.request') {
      const rewritten = {
        ...message,
        sessionId: rootSessionId,
        ask: {
          ...message.ask,
          _originSessionId: message.sessionId,
        },
      };
      const authority = message.authority ?? { visibilityScope: 'controller_only' as const, resolutionMode: 'controller_only' as const };
      emitToAskTargets(rootSessionId, authority, {
        kind: 'ask',
        action: 'requested',
        sessionId: rewritten.sessionId,
        toolCallId: rewritten.toolCallId,
        toolName: rewritten.toolName,
        ask: rewritten.ask,
        requestId: rewritten.requestId,
        authority: rewritten.authority,
      });
    } else if (message.type === 'ask.timeout') {
      const rewritten = {
        ...message,
        sessionId: rootSessionId,
      };
      emitToController(rootSessionId, {
        kind: 'ask',
        action: 'timed_out',
        sessionId: rewritten.sessionId,
        toolCallId: rewritten.toolCallId,
        requestId: rewritten.requestId,
      });
    }
  };

  try {
    for await (const event of streamChat({
      sessionId: childSessionId,
      preconfig,
      messages,
      workspacePath,
      workspaceId,
      additionalPaths,
      modelId: modelId ?? undefined,
      providerId: providerId ?? undefined,
      variant: variant ?? undefined,
      maxSteps: getLLMSubagentMaxSteps(),
      broadcastFn: askBroadcastFn,
      retryAbortController,
      ...(responseFormat ? { responseFormat } : {}),
    })) {
    if (event.type === 'message.created') {
      broadcastToSessionFn({ kind: 'message', action: 'created', message: event.message });
    } else if (event.type === 'part.created') {
      finalParts.push(event.part);
      broadcastToSessionFn({ kind: 'part', action: 'created', sessionId: event.sessionId, part: event.part });
    } else if (event.type === 'part.append' && event.field === 'text') {
      const part = finalParts.find(p => p.id === event.partId);
      if (part && part.type === 'text') {
        part.text = (part.text || '') + event.delta;
      }
      broadcastToSessionFn({
        kind: 'part',
        action: 'append',
        sessionId: event.sessionId,
        partId: event.partId,
        field: event.field,
        delta: event.delta,
      });
    } else if (event.type === 'part.updated') {
      broadcastToSessionFn({ kind: 'part', action: 'updated', sessionId: event.sessionId, part: event.part });
    } else if (event.type === 'message.updated' && event.message.role === 'assistant') {
      // Capture structured output if present on the final message
      if ('structuredOutput' in event.message && event.message.structuredOutput) {
        structuredOutput = event.message.structuredOutput as StructuredOutputData;
      }
      await updateMessage(event.message.id, event.message, { syncFts: false });
      if (event.message.mode !== 'retry_failed') {
        emitTerminal(event.message, childSessionId);
      }
      broadcastToSessionFn({ kind: 'message', action: 'updated', message: event.message });
    } else if (event.type === 'usage') {
      const currentSession = await getSession(childSessionId);
      if (currentSession) {
        await updateSession(childSessionId, {
          promptTokens: event.usage.promptTokens,
          completionTokens: event.usage.completionTokens,
          totalTokens: event.usage.totalTokens,
          cacheReadTokens: event.usage.cacheReadTokens,
          cacheWriteTokens: event.usage.cacheWriteTokens,
          noCacheTokens: event.usage.noCacheTokens,
        });
      }
      broadcastToSessionFn({
        kind: 'usage',
        sessionId: childSessionId,
        usage: event.usage,
        model: event.model,
        variant: event.variant ?? undefined,
      });
    } else if (event.type === 'chat.retry') {
      broadcastToSessionFn({
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
    } else if (event.type === 'error.rate_limit') {
      error ??= event.message;
      console.warn(`[Child Session ${childSessionId}] Rate limited after retries: ${event.message}`);
    } else if (event.type === 'error.server') {
      error ??= event.message;
      console.warn(`[Child Session ${childSessionId}] Server error: ${event.message}`);
    } else if (event.type === 'error.timeout') {
      error ??= event.message;
      console.warn(`[Child Session ${childSessionId}] Timeout: ${event.message}`);
    } else if (event.type === 'error' || event.type === 'error.auth' || event.type === 'error.invalid_request') {
      const errMsg = event.message;
      if (!error) {
        error = errMsg;
      }
      console.error(`[Child Session ${childSessionId}] ${event.type}: ${errMsg}`);
    }
    }
  } catch (err) {
    const classified = classifyApiError(err);
    error = classified.message;

    if (classified.retryable) {
      console.error(`[Child Session ${childSessionId}] Retryable error (${classified.type}): ${classified.message}`);
    } else {
      console.error(`[Child Session ${childSessionId}] Non-retryable error (${classified.type}): ${classified.message}`);
    }
  } finally {
    abortSignal?.removeEventListener('abort', abortHandler);
  }

  return {
    parts: finalParts,
    error,
    ...(structuredOutput ? { structuredOutput } : {}),
  };
}
