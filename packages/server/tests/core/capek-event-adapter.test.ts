import { describe, expect, test } from 'bun:test';
import type { RuntimeEvent } from '@capekai/core/compat/jean2';
import type { ServerMessage } from '@jean2/sdk';
import {
  createJean2RuntimeContext,
  deliverCapekEvent,
  mapCapekEventToServerMessage,
  type Jean2EventRouter,
} from '@/capek-event-adapter';

function map(event: RuntimeEvent): unknown {
  return mapCapekEventToServerMessage(event);
}

describe('Čapek event adapter', () => {
  test('maps message, part, session, usage, retry, and queue events to exact Jean2 shapes', () => {
    const message = { id: 'message-1', sessionId: 'session-1', role: 'user', createdAt: 1 } as const;
    const part = { id: 'part-1', messageId: 'message-1', type: 'text', text: 'hello', createdAt: 1 } as const;
    const session = { id: 'session-1', title: 'Title' } as never;
    const queued = { id: 'queue-1', sessionId: 'session-1', content: 'next', position: 0, createdAt: 1 };

    expect(map({ kind: 'message', action: 'created', message })).toEqual({ type: 'message.created', message });
    expect(map({ kind: 'part', action: 'updated', sessionId: 'session-1', part })).toEqual({
      type: 'part.updated',
      sessionId: 'session-1',
      part,
    });
    expect(map({ kind: 'part', action: 'append', sessionId: 'session-1', partId: 'part-1', field: 'text', delta: 'x' })).toEqual({
      type: 'part.append',
      sessionId: 'session-1',
      partId: 'part-1',
      field: 'text',
      delta: 'x',
    });
    expect(map({ kind: 'session', action: 'renamed', session })).toEqual({ type: 'session.renamed', session });
    expect(map({ kind: 'usage', sessionId: 'session-1', usage: {
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      noCacheTokens: 3,
    }, model: 'model-1', variant: 'fast' })).toEqual({
      type: 'chat.usage',
      sessionId: 'session-1',
      usage: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        noCacheTokens: 3,
      },
      model: 'model-1',
      variant: 'fast',
    });
    expect(map({
      kind: 'retry',
      sessionId: 'session-1',
      status: 'scheduled',
      attempt: 2,
      maxAttempts: 3,
      errorType: 'rate_limit',
      message: 'retry',
      delayMs: 100,
      retryAt: 200,
    })).toEqual({
      type: 'chat.retry',
      sessionId: 'session-1',
      status: 'scheduled',
      retryNumber: 2,
      maxRetries: 3,
      errorType: 'rate_limit',
      message: 'retry',
      delayMs: 100,
      retryAt: 200,
    });
    expect(map({ kind: 'queue', action: 'added', sessionId: 'session-1', message: queued })).toEqual({
      type: 'queue.added',
      sessionId: 'session-1',
      message: queued,
    });
  });

  test('maps failures and ask authority without changing Jean2 fields', () => {
    expect(map({
      kind: 'failure',
      category: 'rate_limit',
      code: 'rate_limit',
      message: 'slow down',
      retryAfterMs: 1000,
      sessionId: 'session-1',
    })).toEqual({
      type: 'error.rate_limit',
      code: 'rate_limit',
      message: 'slow down',
      retryAfterMs: 1000,
      sessionId: 'session-1',
    });

    const authority = { visibilityScope: 'controller_only' as const, resolutionMode: 'controller_only' as const };
    expect(map({
      kind: 'ask',
      action: 'requested',
      sessionId: 'session-1',
      toolCallId: 'call-1',
      toolName: 'question',
      ask: { type: 'text', target: 'human', question: 'Continue?' },
      requestId: 'request-1',
      authority,
    })).toEqual({
      type: 'ask.request',
      sessionId: 'session-1',
      toolCallId: 'call-1',
      toolName: 'question',
      ask: { type: 'text', target: 'human', question: 'Continue?' },
      requestId: 'request-1',
      authority,
    });
    expect(map({
      kind: 'ask',
      action: 'timed_out',
      sessionId: 'session-1',
      toolCallId: 'call-1',
      requestId: 'request-1',
    })).toEqual({
      type: 'ask.timeout',
      sessionId: 'session-1',
      toolCallId: 'call-1',
      requestId: 'request-1',
    });
  });

  test('routes each audience through the matching Jean2 host operation', () => {
    const calls: string[] = [];
    const messages: ServerMessage[] = [];
    const router: Jean2EventRouter<object> = {
      send: (_origin, message) => {
        calls.push('origin');
        messages.push(message);
      },
      broadcast: (message) => {
        calls.push('global');
        messages.push(message);
      },
      broadcastToSession: (_sessionId, message) => {
        calls.push('session');
        messages.push(message);
      },
      sendToController: (_sessionId, message) => {
        calls.push('controller');
        messages.push(message);
      },
      sendToAskTargets: (_sessionId, _authority, message) => {
        calls.push('ask_targets');
        messages.push(message);
      },
      attachOriginToSession: () => calls.push('attached'),
    };
    const context = createJean2RuntimeContext(router);
    const failure = { kind: 'failure', category: 'generic', code: 'test', message: 'test' } as const;

    context.emit({ audience: { scope: 'origin', origin: {} }, event: failure });
    context.emit({ audience: { scope: 'session', sessionId: 'session-1' }, event: failure });
    context.emit({ audience: { scope: 'global' }, event: failure });
    context.emit({ audience: { scope: 'controller', sessionId: 'session-1' }, event: failure });
    context.emit({
      audience: {
        scope: 'ask_targets',
        sessionId: 'session-1',
        authority: { visibilityScope: 'controller_only', resolutionMode: 'controller_only' },
      },
      event: failure,
    });
    context.attachOriginToSession({}, 'session-1');

    expect(calls).toEqual(['origin', 'session', 'global', 'controller', 'ask_targets', 'attached']);
    expect(messages).toHaveLength(5);
    expect(messages.every((message) => message.type === 'error')).toBe(true);
  });

  test('ignores origin-scoped events that bypass the request context adapter', () => {
    expect(deliverCapekEvent({
      audience: { scope: 'origin', origin: {} },
      event: { kind: 'failure', category: 'generic', code: 'test', message: 'test' },
    })).toBeUndefined();
  });

  test('keeps terminal notification intents out of the Jean2 socket protocol', () => {
    expect(map({
      kind: 'terminal',
      sessionId: 'session-1',
      message: { id: 'assistant-1', role: 'assistant' } as never,
    })).toBeNull();
  });
});
