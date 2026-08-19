/**
 * C6 retry stream loop. `streamChatWithRetry` keeps its exact pre-C6 event
 * shape, wire errors, message finalization, interrupt registration, and
 * running-state updates; every policy decision (classification, backoff,
 * circuit state, and the tool-activity side-effect barrier) resolves through
 * `getRetryPolicy()`, so composed agent scopes run on their own agent-scoped
 * policy while unscoped consumers keep the process-default behavior.
 *
 * Its core edges are named and AST-gated by the `retry-domain-no-core` rule:
 * the session interrupt manager for backoff cancellation and the turn stream
 * it wraps. Both stay in core until their owning phases (C6/C7).
 */

import type { ChatOptions } from '../core/agent';
import type { UsageEventData } from '../core/step-handlers';
import type {
  AssistantMessage, AuthErrorMessage, ChatRetryMessage, ContextOverflowErrorMessage, ErrorMessage, InvalidRequestErrorMessage, MessageEvent, RateLimitErrorMessage, ServerErrorMessage, TimeoutErrorMessage, ToolPart } from '@capekai/types';
import {
  ApiErrorType,
  ERROR_CHAT_FAILED,
  ERROR_RATE_LIMIT,
  ERROR_SERVER_ERROR,
  ERROR_TIMEOUT,
  type ClassifiedError,
} from '../utils/errors';
import { emitSessionUpdated } from '../runtime/host-dependencies';
import {
  getPartsByMessage,
  getSession,
  syncMessageFts,
  transitionToolToInterrupted,
  updateMessage,
  updateSession,
} from '../storage/runtime';
import { rejectPendingAsksBySession } from '../permission/ask-user-api';
import { interruptManager } from '../core/interrupt';
import {
  getRetryPolicy,
  RetryDelayAbortedError,
  type StreamRetryPolicy,
} from './policy';

export type StreamChatEvent =
  | MessageEvent
  | { type: 'usage'; usage: UsageEventData; model: string; variant: string | null }
  | { type: 'needs_compaction'; sessionId: string }
  | ChatRetryMessage
  | RateLimitErrorMessage
  | ServerErrorMessage
  | TimeoutErrorMessage
  | AuthErrorMessage
  | ContextOverflowErrorMessage
  | InvalidRequestErrorMessage
  | ErrorMessage;

export type StreamChatFn = (options: ChatOptions) => AsyncGenerator<StreamChatEvent>;

async function finalizeFailedAttempt(
  message: AssistantMessage | null,
  classifiedError: { message: string },
  retryFailed: boolean,
): Promise<MessageEvent[]> {
  if (!message) return [];

  const events: MessageEvent[] = [];
  const parts = await getPartsByMessage(message.id);
  for (const part of parts) {
    if (part.type !== 'tool') continue;
    const toolPart = part as ToolPart;
    if (toolPart.state.status !== 'pending' && toolPart.state.status !== 'running') continue;
    const interruptedPart = await transitionToolToInterrupted(toolPart.id, 'error');
    if (interruptedPart) {
      events.push({ type: 'part.updated', sessionId: message.sessionId, part: interruptedPart });
    }
  }

  const errorMessage: AssistantMessage = {
    ...message,
    status: 'error',
    error: classifiedError.message,
    completedAt: Date.now(),
    ...(retryFailed ? { mode: 'retry_failed' as const } : {}),
  };
  updateMessage(message.id, errorMessage, { syncFts: false });
  syncMessageFts(message.id);
  events.push({ type: 'message.updated', message: errorMessage });
  return events;
}

function createFinalErrorEvent(classifiedError: ClassifiedError): StreamChatEvent {
  if (classifiedError.type === ApiErrorType.RateLimit) {
    return {
      type: 'error.rate_limit',
      code: ERROR_RATE_LIMIT,
      message: classifiedError.message,
      retryAfterMs: classifiedError.retryAfterMs ?? 5_000,
    };
  }
  if (classifiedError.type === ApiErrorType.ServerError || classifiedError.type === ApiErrorType.Network) {
    return {
      type: 'error.server',
      code: ERROR_SERVER_ERROR,
      message: classifiedError.message,
      retryAfterMs: classifiedError.retryAfterMs,
    };
  }
  if (classifiedError.type === ApiErrorType.ContextOverflow) {
    return {
      type: 'error.context_overflow',
      code: 'context_overflow',
      message: classifiedError.message,
    };
  }
  if (classifiedError.type === ApiErrorType.Timeout) {
    return {
      type: 'error.timeout',
      code: ERROR_TIMEOUT,
      message: classifiedError.message,
      retryAfterMs: classifiedError.retryAfterMs,
    };
  }
  return {
    type: 'error',
    code: ERROR_CHAT_FAILED,
    message: classifiedError.message,
  };
}

export async function* streamChatWithRetry(
  options: ChatOptions,
  streamChatFn?: StreamChatFn,
  policyOptions: StreamRetryPolicy = {},
): AsyncGenerator<StreamChatEvent> {
  const policy = getRetryPolicy();
  const maxRetries = policyOptions.maxRetries ?? policy.defaults.maxRetries;
  const baseDelayMs = policyOptions.baseDelayMs ?? policy.defaults.baseDelayMs;
  const maxDelayMs = policyOptions.maxDelayMs ?? policy.defaults.maxDelayMs;
  const jitterRatio = policyOptions.jitterRatio ?? policy.defaults.jitterRatio;
  const circuitKey = policy.circuitKey(options.providerId, options.modelId);
  const session = await getSession(options.sessionId);
  const abortController = interruptManager.registerSession(options.sessionId, session?.parentId ?? undefined);
  const isMainSession = session && !session.parentId;

  if (isMainSession) {
    const updatedSession = await updateSession(options.sessionId, { runningAt: new Date().toISOString() });
    if (updatedSession) {
      emitSessionUpdated(updatedSession);
    }
  }

  try {
    const circuitRemainingMs = policy.openCircuitRemainingMs(circuitKey);
    if (circuitRemainingMs > 0) {
      const message = 'Provider is temporarily unavailable after repeated failures.';
      yield {
        type: 'chat.retry',
        sessionId: options.sessionId,
        status: 'exhausted',
        retryNumber: 0,
        maxRetries,
        errorType: 'server_error',
        message,
      };
      yield {
        type: 'error.server',
        code: ERROR_SERVER_ERROR,
        message,
        retryAfterMs: circuitRemainingMs,
      };
      return;
    }

    let retries = 0;
    while (retries <= maxRetries) {
      let lastAssistantMessage: AssistantMessage | null = null;
      let attemptHadToolActivity = false;

      try {
        const stream = streamChatFn ?? (await import('../core/agent')).streamChat;
        for await (const event of stream({ ...options, retryAbortController: abortController })) {
          if (event.type === 'message.created' || event.type === 'message.updated') {
            if (event.message.role === 'assistant') {
              lastAssistantMessage = event.message as AssistantMessage;
            }
          } else if (
            (event.type === 'part.created' || event.type === 'part.updated')
            && event.part.type === 'tool'
          ) {
            attemptHadToolActivity = true;
          }
          yield event;
        }
        policy.resetCircuit(circuitKey);
        return;
      } catch (err) {
        const classifiedError = policy.classify(err);
        const retryNumber = retries + 1;
        const policyCanRetry = policy.canRetry({
          retryNumber,
          maxRetries,
          classified: classifiedError,
          attemptHadToolActivity,
          aborted: abortController.signal.aborted,
        });
        // C6 step 6: mandatory side-effect barrier enforced by the runtime
        // loop from non-overridable runtime evidence. A custom policy can
        // only advise; it can never authorize a replay after tool activity
        // or after the run was aborted.
        const canRetry = policyCanRetry
          && !attemptHadToolActivity
          && !abortController.signal.aborted;
        const circuitOpened = classifiedError.retryable
          && !canRetry
          && !abortController.signal.aborted
          ? policy.recordCircuitFailure(circuitKey)
          : false;

        console.error('[streamChatWithRetry] AI SDK error', {
          sessionId: options.sessionId,
          model: options.modelId,
          provider: options.providerId,
          attempt: retries + 1,
          maxRetries,
          errorType: classifiedError.type,
          errorMessage: classifiedError.message,
          retryable: classifiedError.retryable,
          attemptHadToolActivity,
          circuitOpened,
          rawError: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
        });

        for (const event of await finalizeFailedAttempt(lastAssistantMessage, classifiedError, canRetry)) {
          yield event;
        }

        if (!canRetry) {
          if (classifiedError.retryable) {
            const message = policy.exhaustedMessage({ attemptHadToolActivity, circuitOpened })
              ?? classifiedError.message;
            yield {
              type: 'chat.retry',
              sessionId: options.sessionId,
              status: abortController.signal.aborted ? 'cancelled' : 'exhausted',
              retryNumber: retries,
              maxRetries,
              errorType: policy.retryErrorType(classifiedError),
              message,
            };
          }
          if (!abortController.signal.aborted) {
            yield createFinalErrorEvent(classifiedError);
          }
          return;
        }

        retries = retryNumber;
        const delayMs = policy.calculateDelay(
          retryNumber,
          classifiedError,
          baseDelayMs,
          maxDelayMs,
          jitterRatio,
        );
        const retryAt = Date.now() + delayMs;
        const retryMessage: ChatRetryMessage = {
          type: 'chat.retry',
          sessionId: options.sessionId,
          status: 'scheduled',
          retryNumber,
          maxRetries,
          errorType: policy.retryErrorType(classifiedError),
          message: classifiedError.message,
          delayMs,
          retryAt,
        };
        yield retryMessage;
        console.log(`[streamChatWithRetry] Retrying ${options.sessionId} (${retryNumber}/${maxRetries}) in ${delayMs}ms`);

        try {
          await policy.waitForRetry(delayMs, abortController.signal);
        } catch (delayError) {
          if (!(delayError instanceof RetryDelayAbortedError)) {
            throw delayError;
          }
          yield {
            ...retryMessage,
            status: 'cancelled',
            delayMs: undefined,
            retryAt: undefined,
          };
          return;
        }

        yield {
          ...retryMessage,
          status: 'started',
          delayMs: undefined,
          retryAt: undefined,
        };
      }
    }
  } finally {
    interruptManager.unregisterSession(options.sessionId);
    await rejectPendingAsksBySession(options.sessionId);
    if (isMainSession) {
      const updatedSession = await updateSession(options.sessionId, { runningAt: null });
      if (updatedSession) {
        emitSessionUpdated(updatedSession);
      }
    }
  }
}
