import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { createRetryCircuitState, withRetryCircuitState } from '@capekai/core/compat/jean2';
import { streamChatWithRetry } from '@/core/retry';
import type { StreamChatFn, StreamChatEvent } from '@/core/retry';
import type { ChatOptions } from '@/core/agent';

// Helper to create AI-SDK-compatible errors
function createError(overrides: {
  message: string;
  status?: number;
  isRateLimitError?: boolean;
  isRetryableError?: boolean;
  retryAfterHeader?: string;
}) {
  const error = new Error(overrides.message) as Error & {
    status?: number;
    isRateLimitError?: boolean;
    isRetryableError?: boolean;
    response?: { headers: { get: (name: string) => string | null } };
  };
  if (overrides.status !== undefined) error.status = overrides.status;
  if (overrides.isRateLimitError) error.isRateLimitError = overrides.isRateLimitError;
  if (overrides.isRetryableError) error.isRetryableError = overrides.isRetryableError;
  if (overrides.retryAfterHeader) {
    error.response = {
      headers: {
        get: (name: string) => name === 'retry-after' ? overrides.retryAfterHeader! : null,
      },
    };
  }
  return error;
}

// Mock setTimeout to skip delays in retry tests
const originalSetTimeout = globalThis.setTimeout;

function mockSetTimeout() {
  globalThis.setTimeout = ((fn: () => void, _ms?: number) => originalSetTimeout(fn, 0)) as typeof setTimeout;
}

function restoreSetTimeout() {
  globalThis.setTimeout = originalSetTimeout;
}

function makeOptions(overrides: Partial<ChatOptions> = {}): ChatOptions {
  return {
    sessionId: 'test-session',
    preconfig: {
      id: 'test',
      name: 'test',
      description: '',
      systemPrompt: '',
      tools: [],
      model: null,
      provider: null,
      settings: null,
      isDefault: false,
    },
    messages: [],
    ...overrides,
  };
}

/** Collect all events from an async generator into an array. */
async function collect(gen: AsyncGenerator<StreamChatEvent>): Promise<StreamChatEvent[]> {
  return withRetryCircuitState(createRetryCircuitState(), async () => {
    const events: StreamChatEvent[] = [];
    for await (const event of gen) {
      events.push(event);
    }
    return events;
  });
}

describe('streamChatWithRetry', () => {
  beforeEach(() => {
    setupTestDatabase();
    mockSetTimeout();
  });

  afterEach(() => {
    restoreSetTimeout();
    resetTestDatabase();
  });

  test('yields events from successful stream', async () => {
    let callCount = 0;
    const mockStream: StreamChatFn = async function* (_options: ChatOptions) {
      callCount++;
      yield { type: 'message.created', message: { id: 'm1', role: 'user', sessionId: 's1', createdAt: 0 } } as StreamChatEvent;
      yield { type: 'part.created', sessionId: 's1', part: { id: 'p1', type: 'text', text: 'Hello' } } as StreamChatEvent;
    };

    const events = await collect(streamChatWithRetry(makeOptions(), mockStream));

    expect(events).toHaveLength(2);
    expect(callCount).toBe(1);
  });

  test('retries on retryable errors and eventually succeeds', async () => {
    let callCount = 0;
    const mockStream: StreamChatFn = async function* (_options: ChatOptions) {
      callCount++;
      if (callCount <= 2) {
        throw createError({ message: 'Internal server error', status: 500 });
      }
      yield { type: 'message.created', message: { id: 'm1', role: 'user', sessionId: 's1', createdAt: 0 } } as StreamChatEvent;
    };

    const events = await collect(streamChatWithRetry(makeOptions(), mockStream));

    expect(events.map((event) => event.type)).toEqual([
      'chat.retry',
      'chat.retry',
      'chat.retry',
      'chat.retry',
      'message.created',
    ]);
    expect(
      events
        .filter((event) => event.type === 'chat.retry')
        .map((event) => event.status),
    ).toEqual(['scheduled', 'started', 'scheduled', 'started']);
    expect(callCount).toBe(3);
  });

  test('yields rate limit error event when max retries hit', async () => {
    let callCount = 0;
    // eslint-disable-next-line require-yield
    const mockStream: StreamChatFn = async function* (_options: ChatOptions) {
      callCount++;
      throw createError({
        message: 'Rate limit exceeded',
        status: 429,
        retryAfterHeader: '0',
      });
    };

    const events = await collect(streamChatWithRetry(makeOptions(), mockStream));

    expect(events).toHaveLength(8);
    expect(events.slice(0, -2).map((event) => event.type)).toEqual([
      'chat.retry',
      'chat.retry',
      'chat.retry',
      'chat.retry',
      'chat.retry',
      'chat.retry',
    ]);
    const exhaustedEvent = events.at(-2);
    expect(exhaustedEvent?.type).toBe('chat.retry');
    if (exhaustedEvent?.type === 'chat.retry') {
      expect(exhaustedEvent.status).toBe('exhausted');
    }
    const errorEvent = events.at(-1);
    expect(errorEvent?.type).toBe('error.rate_limit');
    if (errorEvent?.type === 'error.rate_limit') {
      expect(errorEvent.code).toBe('rate_limit');
    }
    expect(callCount).toBe(4);
  });

  test('yields context overflow error without retrying', async () => {
    let callCount = 0;
    // eslint-disable-next-line require-yield
    const mockStream: StreamChatFn = async function* (_options: ChatOptions) {
      callCount++;
      throw createError({
        message: 'context window exceeds limit',
        status: 400,
      });
    };

    const events = await collect(streamChatWithRetry(makeOptions(), mockStream));

    expect(events).toHaveLength(1);
    const errorEvent = events[0] as { type: string };
    expect(errorEvent.type).toBe('error.context_overflow');
    expect(callCount).toBe(1);
  });

  test('yields server error when max retries exceeded', async () => {
    let callCount = 0;
    // eslint-disable-next-line require-yield
    const mockStream: StreamChatFn = async function* (_options: ChatOptions) {
      callCount++;
      throw createError({ message: 'Server error', status: 500 });
    };

    const events = await collect(streamChatWithRetry(makeOptions(), mockStream));

    expect(events).toHaveLength(8);
    const exhaustedEvent = events.at(-2);
    expect(exhaustedEvent?.type).toBe('chat.retry');
    if (exhaustedEvent?.type === 'chat.retry') {
      expect(exhaustedEvent.status).toBe('exhausted');
    }
    expect(events.at(-1)?.type).toBe('error.server');
    expect(callCount).toBe(4);
  });

  test('yields generic error for non-retryable unknown errors', async () => {
    let callCount = 0;
    // eslint-disable-next-line require-yield
    const mockStream: StreamChatFn = async function* (_options: ChatOptions) {
      callCount++;
      throw new Error('Something unexpected');
    };

    const events = await collect(streamChatWithRetry(makeOptions(), mockStream));

    expect(events).toHaveLength(1);
    const errorEvent = events[0] as { type: string; code: string };
    expect(errorEvent.type).toBe('error');
    expect(errorEvent.code).toBe('chat_error');
    expect(callCount).toBe(1);
  });

  test('does not retry after tool activity', async () => {
    let callCount = 0;
    const mockStream: StreamChatFn = async function* (_options: ChatOptions) {
      callCount++;
      yield {
        type: 'part.created',
        sessionId: 'test-session',
        part: {
          id: 'tool-part',
          messageId: 'assistant-message',
          type: 'tool',
          name: 'write-file',
          callId: 'tool-call',
          state: { status: 'running', input: {} },
          createdAt: 0,
        },
      } as StreamChatEvent;
      throw createError({ message: 'Server error', status: 500 });
    };

    const events = await collect(streamChatWithRetry(makeOptions(), mockStream));

    expect(callCount).toBe(1);
    expect(events.map((event) => event.type)).toEqual([
      'part.created',
      'chat.retry',
      'error.server',
    ]);
    const retryEvent = events[1];
    expect(retryEvent.type).toBe('chat.retry');
    if (retryEvent.type === 'chat.retry') {
      expect(retryEvent.status).toBe('exhausted');
      expect(retryEvent.message).toContain('used a tool');
    }
  });

  test('cancels retry while waiting for backoff', async () => {
    globalThis.setTimeout = originalSetTimeout;
    // eslint-disable-next-line require-yield
    const mockStream: StreamChatFn = async function* (options: ChatOptions) {
      options.retryAbortController?.abort();
      throw createError({ message: 'Server error', status: 500 });
    };

    const events = await collect(streamChatWithRetry(makeOptions({
      modelId: 'cancellation-model',
      providerId: 'cancellation-provider',
    }), mockStream, {
      baseDelayMs: 1,
      maxDelayMs: 1,
      jitterRatio: 0,
    }));

    expect(events.map((event) => event.type)).toEqual(['chat.retry']);
    const retryEvent = events[0];
    expect(retryEvent.type).toBe('chat.retry');
    if (retryEvent.type === 'chat.retry') {
      expect(retryEvent.status).toBe('cancelled');
    }
  });
});
