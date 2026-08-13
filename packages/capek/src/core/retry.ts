import type { ChatOptions } from './agent';
import type { UsageEventData } from './step-handlers';
import {
  classifyApiError,
  ApiErrorType,
  ERROR_RATE_LIMIT,
  ERROR_SERVER_ERROR,
  ERROR_TIMEOUT,
  ERROR_CHAT_FAILED,
} from '../utils/errors';
import type { ClassifiedError } from '../utils/errors';
import type {
  AssistantMessage,
  AuthErrorMessage,
  ChatRetryErrorType,
  ChatRetryMessage,
  ContextOverflowErrorMessage,
  ErrorMessage,
  InvalidRequestErrorMessage,
  MessageEvent,
  RateLimitErrorMessage,
  ServerErrorMessage,
  TimeoutErrorMessage,
  ToolPart,
} from '@jean2/sdk';
import { broadcastSessionUpdated } from '../compat/jean2-dependencies';
import {
  getPartsByMessage,
  getSession,
  syncMessageFts,
  transitionToolToInterrupted,
  updateMessage,
  updateSession,
} from '../storage/runtime';
import { rejectPendingAsksBySession } from '../tools/ask-user-api';
import { interruptManager } from './interrupt';

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

export interface StreamRetryPolicy {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
}

interface CircuitState {
  failures: number;
  lastFailureAt: number;
  openUntil: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 2_000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_JITTER_RATIO = 0.2;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_FAILURE_WINDOW_MS = 60_000;
const CIRCUIT_COOLDOWN_MS = 30_000;
const circuitStates = new Map<string, CircuitState>();

class RetryDelayAbortedError extends Error {
  constructor() {
    super('Retry delay aborted');
    this.name = 'RetryDelayAbortedError';
  }
}

function getCircuitKey(options: ChatOptions): string {
  return `${options.providerId ?? 'default'}:${options.modelId ?? 'default'}`;
}

function getOpenCircuitRemainingMs(key: string): number {
  const state = circuitStates.get(key);
  if (!state) return 0;

  const now = Date.now();
  if (state.openUntil === 0) {
    if (now - state.lastFailureAt > CIRCUIT_FAILURE_WINDOW_MS) {
      circuitStates.delete(key);
    }
    return 0;
  }
  if (state.openUntil <= now) {
    circuitStates.delete(key);
    return 0;
  }
  return state.openUntil - now;
}

function recordCircuitFailure(key: string): boolean {
  const now = Date.now();
  const previous = circuitStates.get(key);
  const previousFailures = previous && now - previous.lastFailureAt <= CIRCUIT_FAILURE_WINDOW_MS
    ? previous.failures
    : 0;
  const failures = previousFailures + 1;
  const openUntil = failures >= CIRCUIT_FAILURE_THRESHOLD
    ? now + CIRCUIT_COOLDOWN_MS
    : 0;
  circuitStates.set(key, { failures, lastFailureAt: now, openUntil });
  return openUntil > 0;
}

function resetCircuit(key: string): void {
  circuitStates.delete(key);
}

function toRetryErrorType(type: ApiErrorType): ChatRetryErrorType {
  if (type === ApiErrorType.RateLimit) return 'rate_limit';
  if (type === ApiErrorType.Timeout) return 'timeout';
  if (type === ApiErrorType.Network) return 'network';
  return 'server_error';
}

function calculateRetryDelay(
  retryNumber: number,
  classifiedError: ClassifiedError,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterRatio: number,
): number {
  const exponentialDelay = Math.min(baseDelayMs * 2 ** (retryNumber - 1), maxDelayMs);
  const jitterRange = exponentialDelay * jitterRatio;
  const jitteredDelay = Math.round(exponentialDelay - jitterRange + Math.random() * jitterRange * 2);
  return Math.max(jitteredDelay, classifiedError.retryAfterMs ?? 0);
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new RetryDelayAbortedError());
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      reject(new RetryDelayAbortedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function finalizeFailedAttempt(
  message: AssistantMessage | null,
  classifiedError: ClassifiedError,
  retryFailed: boolean,
): MessageEvent[] {
  if (!message) return [];

  const events: MessageEvent[] = [];
  const parts = getPartsByMessage(message.id);
  for (const part of parts) {
    if (part.type !== 'tool') continue;
    const toolPart = part as ToolPart;
    if (toolPart.state.status !== 'pending' && toolPart.state.status !== 'running') continue;
    const interruptedPart = transitionToolToInterrupted(toolPart.id, 'error');
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
  policy: StreamRetryPolicy = {},
): AsyncGenerator<StreamChatEvent> {
  const maxRetries = policy.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = policy.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = policy.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterRatio = policy.jitterRatio ?? DEFAULT_JITTER_RATIO;
  const circuitKey = getCircuitKey(options);
  const abortController = interruptManager.registerSession(options.sessionId);
  const session = getSession(options.sessionId);
  const isMainSession = session && !session.parentId;

  if (isMainSession) {
    const updatedSession = updateSession(options.sessionId, { runningAt: new Date().toISOString() });
    if (updatedSession) {
      broadcastSessionUpdated(updatedSession);
    }
  }

  try {
    const circuitRemainingMs = getOpenCircuitRemainingMs(circuitKey);
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
        const stream = streamChatFn ?? (await import('./agent')).streamChat;
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
        resetCircuit(circuitKey);
        return;
      } catch (err) {
        const classifiedError = isClassifiedError(err) ? err : classifyApiError(err);
        const retryNumber = retries + 1;
        const hasRetriesRemaining = retries < maxRetries;
        const canRetry = classifiedError.retryable
          && hasRetriesRemaining
          && !attemptHadToolActivity
          && !abortController.signal.aborted;
        const circuitOpened = classifiedError.retryable
          && !canRetry
          && !abortController.signal.aborted
          ? recordCircuitFailure(circuitKey)
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

        for (const event of finalizeFailedAttempt(lastAssistantMessage, classifiedError, canRetry)) {
          yield event;
        }

        if (!canRetry) {
          if (classifiedError.retryable) {
            let message = classifiedError.message;
            if (attemptHadToolActivity) {
              message = 'Automatic retry stopped because the failed attempt used a tool and replay could duplicate side effects.';
            } else if (circuitOpened) {
              message = 'Automatic retry stopped after repeated provider failures.';
            }
            yield {
              type: 'chat.retry',
              sessionId: options.sessionId,
              status: abortController.signal.aborted ? 'cancelled' : 'exhausted',
              retryNumber: retries,
              maxRetries,
              errorType: toRetryErrorType(classifiedError.type),
              message,
            };
          }
          if (!abortController.signal.aborted) {
            yield createFinalErrorEvent(classifiedError);
          }
          return;
        }

        retries = retryNumber;
        const delayMs = calculateRetryDelay(
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
          errorType: toRetryErrorType(classifiedError.type),
          message: classifiedError.message,
          delayMs,
          retryAt,
        };
        yield retryMessage;
        console.log(`[streamChatWithRetry] Retrying ${options.sessionId} (${retryNumber}/${maxRetries}) in ${delayMs}ms`);

        try {
          await waitForRetry(delayMs, abortController.signal);
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
    rejectPendingAsksBySession(options.sessionId);
    if (isMainSession) {
      const updatedSession = updateSession(options.sessionId, { runningAt: null });
      if (updatedSession) {
        broadcastSessionUpdated(updatedSession);
      }
    }
  }
}

function isClassifiedError(err: unknown): err is ClassifiedError {
  if (typeof err !== 'object' || err === null) {
    return false;
  }

  const candidate = err as Record<string, unknown>;
  return (
    typeof candidate.type === 'string'
    && typeof candidate.retryable === 'boolean'
    && typeof candidate.message === 'string'
    && 'originalError' in candidate
  );
}
