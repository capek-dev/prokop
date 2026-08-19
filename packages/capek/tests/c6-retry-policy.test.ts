import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChatOptions } from '../src/core/agent';
import type {
  StreamChatEvent,
  StreamChatFn,
} from '../src/retry/stream-chat';
import { streamChatWithRetry } from '../src/retry/stream-chat';
import {
  createRetryCircuitState,
  createRetryPolicy,
  getRetryPolicy,
  resetDefaultRetryPolicyForTests,
  RetryDelayAbortedError,
  withRetryCircuitState,
  type CircuitState,
  type RetryPolicy,
} from '../src/retry/policy';
import { ApiErrorType, classifyApiError } from '../src/utils/errors';
import { configureRuntimeConfiguration } from '../src/configuration/runtime';
import { createDefaultRuntimeConfiguration } from '../src/configuration/defaults';
import { configureRuntimeHost, type RuntimeHost } from '../src/runtime/host';
import { createInMemoryStorageBundle } from '../src/storage/memory';
import { configureStorage } from '../src/storage/runtime';
import { configureSchedulerHost, type SchedulerHost } from '../src/scheduler/host';
import { configureSessionSearchHost, type SessionSearchHost } from '../src/session-search/host';
import { createAgentScope } from '../src/kernel/kernel';
import {
  enterAgentScope,
} from '../src/plugins/compose';
import { createCurrentAgentScope, createCurrentProcessScope } from './helpers/composition';
import { currentAgentPlugins } from './helpers/composition';
import { capekRetryPolicyKey } from '../src/plugins/service-keys';

function createError(overrides: {
  message: string;
  status?: number;
  isRateLimitError?: boolean;
  isRetryableError?: boolean;
  retryAfterHeader?: string;
}): Error & {
  status?: number;
  isRateLimitError?: boolean;
  isRetryableError?: boolean;
  response?: { headers: { get: (name: string) => string | null } };
} {
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

function makeOptions(overrides: Partial<ChatOptions> = {}): ChatOptions {
  return {
    sessionId: 'c6-test-session',
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

async function collect(gen: AsyncGenerator<StreamChatEvent>): Promise<StreamChatEvent[]> {
  const events: StreamChatEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** One-millisecond backoff so loop tests never wait; jitter disabled for
 * deterministic delays. */
const FAST_POLICY_OPTIONS = { baseDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 };

function minimalHost(): RuntimeHost {
  return {
    interaction: {
      createPendingAsk: async () => 'pending',
      removePendingAsk: async () => {},
      removePendingAsksByToolCallId: async () => {},
      getPermissionRequestByRequestId: async () => null,
      resolvePermissionRequestByRequestId: async () => false,
      expirePermissionRequest: async () => false,
      expireOldPermissionRequests: async () => 0,
      cancelPendingRequestsBySession: async () => 0,
      listPendingAsksBySession: async () => [],
      listPendingAsksByRootSession: async () => [],
      listPendingRequestsByRootSession: async () => [],
      matchGrant: async () => ({ matched: false, grant: null }),
      createGrantFromOptions: async () => null,
      getSessionAutoApproveSeverity: async () => undefined,
      getPermissionTimeoutMs: () => 30 * 60 * 1000,
      notifyPermissionRequired: async () => {},
    },
    delivery: { emit: () => {} },
    titles: {
      isDefaultSessionTitle: () => true,
      hasManualSessionTitle: () => false,
      generateSessionTitle: async () => null,
    },
    workspace: {
      createToolWorkspaceHost: () => ({
        root: '/tmp',
        additionalRoots: undefined,
        allowedRoots: [],
        tempDir: '/tmp/capek-c6-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

function minimalSearchHost(): SessionSearchHost {
  return {
    getWorkspace: async () => null,
    getSession: async () => null,
    listWorkspaceSessions: async () => [],
    listAgentSessions: async () => [],
    countSessionMessages: async () => 0,
    searchMessages: async () => [],
    countMessagesBefore: async () => 0,
    countMessagesAfter: async () => 0,
    getLatestMessage: async () => null,
    getMessage: async () => null,
    listMessagesBefore: async () => [],
    listMessagesAfter: async () => [],
    getMessageSummary: async () => null,
  };
}

function minimalSchedulerHost(): SchedulerHost {
  return {
    create: () => {
      throw new Error('not configured');
    },
    get: () => null,
    list: () => [],
    update: () => null,
    delete: () => false,
    trigger: () => {},
  };
}

beforeEach(() => {
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeConfiguration(createDefaultRuntimeConfiguration());
  configureRuntimeHost(minimalHost());
  configureSessionSearchHost(minimalSearchHost());
  configureSchedulerHost(minimalSchedulerHost());
});

afterEach(() => {
  resetDefaultRetryPolicyForTests();
});

describe('C6 default retry policy contract', () => {
  test('pins the exact current numeric defaults', () => {
    const policy = createRetryPolicy({ id: 'test' });
    expect(policy.defaults).toEqual({
      maxRetries: 3,
      baseDelayMs: 2_000,
      maxDelayMs: 30_000,
      jitterRatio: 0.2,
    });
  });

  test('classify reproduces exact HEAD classification including nested originalError recursion', () => {
    const policy = createRetryPolicy();
    const raw = createError({ message: 'Internal server error', status: 500 });
    const classified = policy.classify(raw);
    expect(classified.type).toBe(ApiErrorType.ServerError);
    expect(classified.retryable).toBe(true);
    expect(classified.originalError).toBe(raw);

    // HEAD parity: core/retry.ts at 2cc279b passes an already-classified
    // error through unchanged, so the contract keeps that exact behavior.
    expect(policy.classify(classified)).toBe(classified);

    // HEAD classifyApiError recursion: a wrapper whose originalError is a
    // retryable 500 classifies as the nested server error, and the wrapper
    // becomes the reported originalError.
    const wrapped = new Error('wrapped provider failure') as Error & { originalError?: unknown };
    wrapped.originalError = raw;
    const nested = policy.classify(wrapped);
    expect(nested.type).toBe(ApiErrorType.ServerError);
    expect(nested.retryable).toBe(true);
    expect(nested.originalError).toBe(wrapped);

    expect(policy.classify(new Error('Something unexpected')).retryable).toBe(false);
    expect(classifyApiError(raw).retryable).toBe(true);
  });

  test('retryErrorType maps the exact current error types', () => {
    const policy = createRetryPolicy();
    const classify = (status: number, message: string) =>
      policy.classify(createError({ message, status }));
    expect(policy.retryErrorType(classify(429, 'rate limit'))).toBe('rate_limit');
    expect(policy.retryErrorType(classify(500, 'server'))).toBe('server_error');
    expect(policy.retryErrorType(policy.classify(createError({ message: 'timeout', isRetryableError: true })))).toBe('server_error');
  });

  test('calculateDelay grows exponentially, stays bounded, and honors Retry-After as a minimum', () => {
    const policy = createRetryPolicy();
    const plain = policy.classify(createError({ message: 'server', status: 500 }));
    expect(policy.calculateDelay(1, plain, 100, 10_000, 0)).toBe(100);
    expect(policy.calculateDelay(2, plain, 100, 10_000, 0)).toBe(200);
    expect(policy.calculateDelay(3, plain, 100, 10_000, 0)).toBe(400);
    expect(policy.calculateDelay(20, plain, 100, 10_000, 0)).toBe(10_000);
    const withRetryAfter = policy.classify(createError({
      message: 'rate limit',
      status: 429,
      retryAfterHeader: '5',
    }));
    expect(policy.calculateDelay(1, withRetryAfter, 100, 10_000, 0)).toBe(5_000);
  });

  test('circuit opens on the third failure within the window and reports remaining time', () => {
    const state = createRetryCircuitState();
    const policy = createRetryPolicy({ circuitState: state });
    expect(policy.recordCircuitFailure('p:m')).toBe(false);
    expect(policy.recordCircuitFailure('p:m')).toBe(false);
    expect(policy.recordCircuitFailure('p:m')).toBe(true);
    const remaining = policy.openCircuitRemainingMs('p:m');
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(30_000);
    expect(policy.openCircuitRemainingMs('other:key')).toBe(0);
  });

  test('circuit failure window and cooldown expiry clear state', () => {
    const state = createRetryCircuitState();
    const policy = createRetryPolicy({ circuitState: state });
    const now = Date.now();

    // Window expiry: a stale previous failure does not count toward the
    // threshold.
    state.set('p:m', { failures: 2, lastFailureAt: now - 61_000, openUntil: 0 });
    expect(policy.recordCircuitFailure('p:m')).toBe(false);
    const staleEntry = state.get('p:m');
    expect(staleEntry?.failures).toBe(1);

    // Cooldown expiry: an open circuit whose cooldown passed closes.
    state.set('p:m', { failures: 3, lastFailureAt: now, openUntil: now - 1 });
    expect(policy.openCircuitRemainingMs('p:m')).toBe(0);
    expect(state.has('p:m')).toBe(false);

    // Window expiry on a closed circuit deletes the stale entry on read.
    state.set('p:m', { failures: 1, lastFailureAt: now - 61_000, openUntil: 0 });
    expect(policy.openCircuitRemainingMs('p:m')).toBe(0);
    expect(state.has('p:m')).toBe(false);

    // resetCircuit closes an open circuit immediately.
    state.set('p:m', { failures: 3, lastFailureAt: now, openUntil: now + 30_000 });
    policy.resetCircuit('p:m');
    expect(policy.openCircuitRemainingMs('p:m')).toBe(0);
  });

  test('the side-effect barrier blocks retry after tool activity', () => {
    const policy = createRetryPolicy();
    const classified = policy.classify(createError({ message: 'server', status: 500 }));
    const base = {
      retryNumber: 1,
      maxRetries: 3,
      classified,
      attemptHadToolActivity: false,
      aborted: false,
    };
    expect(policy.canRetry(base)).toBe(true);
    expect(policy.canRetry({ ...base, attemptHadToolActivity: true })).toBe(false);
    expect(policy.canRetry({ ...base, aborted: true })).toBe(false);
    expect(policy.canRetry({ ...base, retryNumber: 4 })).toBe(false);
    expect(policy.canRetry({
      ...base,
      classified: policy.classify(createError({ message: 'unknown' })),
    })).toBe(false);
  });

  test('exhausted messages pin the exact current barrier text', () => {
    const policy = createRetryPolicy();
    expect(policy.exhaustedMessage({ attemptHadToolActivity: true, circuitOpened: false }))
      .toBe('Automatic retry stopped because the failed attempt used a tool and replay could duplicate side effects.');
    expect(policy.exhaustedMessage({ attemptHadToolActivity: false, circuitOpened: true }))
      .toBe('Automatic retry stopped after repeated provider failures.');
    expect(policy.exhaustedMessage({ attemptHadToolActivity: false, circuitOpened: false }))
      .toBeNull();
  });

  test('waitForRetry rejects with RetryDelayAbortedError on an aborted signal', async () => {
    const policy = createRetryPolicy();
    const controller = new AbortController();
    controller.abort();
    await expect(policy.waitForRetry(1_000, controller.signal)).rejects.toBeInstanceOf(RetryDelayAbortedError);
  });
});

describe('C6 stream loop through the scoped policy', () => {
  test('yields events from a successful stream without retrying', async () => {
    let callCount = 0;
    const mockStream: StreamChatFn = async function* () {
      callCount++;
      yield { type: 'message.created', message: { id: 'm1', role: 'user', sessionId: 's1', createdAt: 0 } } as StreamChatEvent;
      yield { type: 'part.created', sessionId: 's1', part: { id: 'p1', type: 'text', text: 'Hello' } } as StreamChatEvent;
    };

    const events = await collect(streamChatWithRetry(makeOptions(), mockStream));

    expect(events).toHaveLength(2);
    expect(callCount).toBe(1);
  });

  test('retries on retryable errors and eventually succeeds with the exact retry statuses', async () => {
    let callCount = 0;
    const mockStream: StreamChatFn = async function* () {
      callCount++;
      if (callCount <= 2) {
        throw createError({ message: 'Internal server error', status: 500 });
      }
      yield { type: 'message.created', message: { id: 'm1', role: 'user', sessionId: 's1', createdAt: 0 } } as StreamChatEvent;
    };

    const events = await collect(streamChatWithRetry(
      makeOptions({ modelId: 'recovery-model', providerId: 'recovery-provider' }),
      mockStream,
      FAST_POLICY_OPTIONS,
    ));

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

  test('yields the exact rate limit exhaustion events when max retries hit', async () => {
    let callCount = 0;
    // eslint-disable-next-line require-yield
    const mockStream: StreamChatFn = async function* () {
      callCount++;
      throw createError({
        message: 'Rate limit exceeded',
        status: 429,
        retryAfterHeader: '0',
      });
    };

    const events = await collect(streamChatWithRetry(
      makeOptions({ modelId: 'rl-model', providerId: 'rl-provider' }),
      mockStream,
      FAST_POLICY_OPTIONS,
    ));

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
      expect(exhaustedEvent.retryNumber).toBe(3);
      expect(exhaustedEvent.maxRetries).toBe(3);
    }
    const errorEvent = events.at(-1);
    expect(errorEvent?.type).toBe('error.rate_limit');
    if (errorEvent?.type === 'error.rate_limit') {
      expect(errorEvent.code).toBe('rate_limit');
    }
    expect(callCount).toBe(4);
  });

  test('yields the exact server error exhaustion events when max retries exceeded', async () => {
    let callCount = 0;
    // eslint-disable-next-line require-yield
    const mockStream: StreamChatFn = async function* () {
      callCount++;
      throw createError({ message: 'Server error', status: 500 });
    };

    const events = await collect(streamChatWithRetry(
      makeOptions({ modelId: 'srv-model', providerId: 'srv-provider' }),
      mockStream,
      FAST_POLICY_OPTIONS,
    ));

    expect(events).toHaveLength(8);
    const exhausted = events.at(-2);
    expect(exhausted?.type).toBe('chat.retry');
    if (exhausted?.type === 'chat.retry') {
      expect(exhausted.status).toBe('exhausted');
      expect(exhausted.retryNumber).toBe(3);
      expect(exhausted.maxRetries).toBe(3);
    }
    expect(events.at(-1)?.type).toBe('error.server');
    expect(callCount).toBe(4);
  });

  test('yields a context overflow error without retrying', async () => {
    let callCount = 0;
    // eslint-disable-next-line require-yield
    const mockStream: StreamChatFn = async function* () {
      callCount++;
      throw createError({ message: 'context window exceeds limit', status: 400 });
    };

    const events = await collect(streamChatWithRetry(makeOptions(), mockStream));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error.context_overflow');
    expect(callCount).toBe(1);
  });

  test('yields a generic error for non-retryable unknown errors', async () => {
    let callCount = 0;
    // eslint-disable-next-line require-yield
    const mockStream: StreamChatFn = async function* () {
      callCount++;
      throw new Error('Something unexpected');
    };

    const events = await collect(streamChatWithRetry(makeOptions(), mockStream));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    if (events[0].type === 'error') {
      expect(events[0].code).toBe('chat_error');
    }
    expect(callCount).toBe(1);
  });

  test('does not retry after tool activity and reports the side-effect barrier', async () => {
    let callCount = 0;
    const mockStream: StreamChatFn = async function* () {
      callCount++;
      yield {
        type: 'part.created',
        sessionId: 'c6-test-session',
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

    const events = await collect(streamChatWithRetry(
      makeOptions({ modelId: 'tool-model', providerId: 'tool-provider' }),
      mockStream,
      FAST_POLICY_OPTIONS,
    ));

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

  test('cancels an aborted attempt before backoff with retryNumber 0 and no final error', async () => {
    // eslint-disable-next-line require-yield
    const mockStream: StreamChatFn = async function* (options: ChatOptions) {
      options.retryAbortController?.abort();
      throw createError({ message: 'Server error', status: 500 });
    };

    const events = await collect(streamChatWithRetry(
      makeOptions({ modelId: 'cancellation-model', providerId: 'cancellation-provider' }),
      mockStream,
      FAST_POLICY_OPTIONS,
    ));

    expect(events.map((event) => event.type)).toEqual(['chat.retry']);
    const retryEvent = events[0];
    expect(retryEvent.type).toBe('chat.retry');
    if (retryEvent.type === 'chat.retry') {
      expect(retryEvent.status).toBe('cancelled');
      expect(retryEvent.retryNumber).toBe(0);
      expect(retryEvent.maxRetries).toBe(3);
      expect(retryEvent.errorType).toBe('server_error');
    }
  });

  test('cancels during backoff after the scheduled event with retryNumber 1 and no final error', async () => {
    const captured: { controller: AbortController | null } = { controller: null };
    // eslint-disable-next-line require-yield
    const mockStream: StreamChatFn = async function* (options: ChatOptions) {
      captured.controller = options.retryAbortController ?? null;
      throw createError({ message: 'Server error', status: 500 });
    };

    const events: StreamChatEvent[] = [];
    const generator = streamChatWithRetry(
      makeOptions({ modelId: 'backoff-model', providerId: 'backoff-provider' }),
      mockStream,
      { baseDelayMs: 5_000, maxDelayMs: 5_000, jitterRatio: 0 },
    );
    for await (const event of generator) {
      events.push(event);
      if (event.type === 'chat.retry' && event.status === 'scheduled') {
        captured.controller?.abort();
      }
    }

    // Exactly two events: the scheduled retry, then the backoff-abort
    // cancelled retry. No final error event follows a cancelled retry.
    expect(events.map((event) => event.type)).toEqual(['chat.retry', 'chat.retry']);
    const scheduled = events[0];
    expect(scheduled.type).toBe('chat.retry');
    if (scheduled.type === 'chat.retry') {
      expect(scheduled.status).toBe('scheduled');
      expect(scheduled.retryNumber).toBe(1);
      expect(scheduled.maxRetries).toBe(3);
      expect(scheduled.errorType).toBe('server_error');
      expect(scheduled.delayMs).toBeGreaterThan(0);
    }
    const cancelled = events[1];
    expect(cancelled.type).toBe('chat.retry');
    if (cancelled.type === 'chat.retry') {
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.retryNumber).toBe(1);
      expect(cancelled.maxRetries).toBe(3);
      expect(cancelled.errorType).toBe('server_error');
      expect(cancelled.delayMs).toBeUndefined();
      expect(cancelled.retryAt).toBeUndefined();
      expect(cancelled.message).toBe('Server error');
    }
  });

  test('an open circuit short-circuits without calling the stream', async () => {
    const state = createRetryCircuitState();
    const now = Date.now();
    state.set('circuit-provider:circuit-model', {
      failures: 3,
      lastFailureAt: now,
      openUntil: now + 30_000,
    });
    let callCount = 0;
    const mockStream: StreamChatFn = async function* () {
      callCount++;
      yield { type: 'part.created', sessionId: 's1', part: { id: 'p1', type: 'text', text: 'x' } } as StreamChatEvent;
    };

    const events = await withRetryCircuitState(state, () => collect(streamChatWithRetry(
      makeOptions({ modelId: 'circuit-model', providerId: 'circuit-provider' }),
      mockStream,
    )));

    expect(callCount).toBe(0);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('chat.retry');
    if (events[0].type === 'chat.retry') {
      expect(events[0].status).toBe('exhausted');
      expect(events[0].retryNumber).toBe(0);
      expect(events[0].message).toBe('Provider is temporarily unavailable after repeated failures.');
    }
    expect(events[1].type).toBe('error.server');
    if (events[1].type === 'error.server') {
      expect(events[1].code).toBe('server_error');
      expect(events[1].retryAfterMs).toBeGreaterThan(0);
    }
  });

  test('repeated exhausted runs open the circuit and the next run is refused', async () => {
    const state = createRetryCircuitState();
    // eslint-disable-next-line require-yield
    const mockStream: StreamChatFn = async function* () {
      throw createError({ message: 'Server error', status: 500 });
    };

    const run = () => withRetryCircuitState(state, () => collect(streamChatWithRetry(
      makeOptions({ modelId: 'open-model', providerId: 'open-provider' }),
      mockStream,
      FAST_POLICY_OPTIONS,
    )));

    const first = await run();
    const second = await run();
    const third = await run();
    const fourth = await run();

    for (const events of [first, second, third]) {
      const exhausted = events.at(-2);
      expect(exhausted?.type).toBe('chat.retry');
      expect(events.at(-1)?.type).toBe('error.server');
    }
    if (third.at(-2)?.type === 'chat.retry') {
      const thirdExhausted = third.at(-2);
      if (thirdExhausted?.type === 'chat.retry') {
        expect(thirdExhausted.message).toBe('Automatic retry stopped after repeated provider failures.');
      }
    }
    // The fourth run never reaches the stream: the circuit is open.
    expect(fourth.map((event) => event.type)).toEqual(['chat.retry', 'error.server']);
    if (fourth[0].type === 'chat.retry') {
      expect(fourth[0].message).toBe('Provider is temporarily unavailable after repeated failures.');
    }
  });

  test('circuit state is isolated per policy instance and per overlay', () => {
    const policyA = createRetryPolicy({ id: 'a' });
    const policyB = createRetryPolicy({ id: 'b' });

    for (let i = 0; i < 3; i++) policyA.recordCircuitFailure('iso:model');
    expect(policyA.openCircuitRemainingMs('iso:model')).toBeGreaterThan(0);
    expect(policyB.openCircuitRemainingMs('iso:model')).toBe(0);
    expect(policyB.recordCircuitFailure('iso:model')).toBe(false);

    // The withRetryCircuitState overlay replaces only the circuit map.
    const own = createRetryCircuitState();
    const overlay = createRetryCircuitState();
    const policy = createRetryPolicy({ circuitState: own });
    withRetryCircuitState(overlay, () => {
      policy.recordCircuitFailure('overlay:key');
    });
    expect(own.has('overlay:key')).toBe(false);
    expect(overlay.has('overlay:key')).toBe(true);
  });
});

describe('C6 agent-scoped retry policy composition', () => {
  test('the current composition provides an agent-scoped policy with exact defaults', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const policy = agentScope.require(capekRetryPolicyKey);
      expect(policy.id).toBe('current.retry-policy');
      expect(policy.defaults.maxRetries).toBe(3);
      expect(policy.defaults.baseDelayMs).toBe(2_000);
      expect(policy.defaults.maxDelayMs).toBe(30_000);
      expect(policy.defaults.jitterRatio).toBe(0.2);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('enterAgentScope seeds the scope-owned policy and restores the process default outside', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const scopedPolicy = agentScope.require(capekRetryPolicyKey);
      let observed: RetryPolicy | null = null;
      enterAgentScope(agentScope, () => {
        observed = getRetryPolicy();
      });
      expect(observed === scopedPolicy).toBe(true);
      expect(getRetryPolicy() === scopedPolicy).toBe(false);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('two composed agent scopes own distinct policies with isolated circuit state', async () => {
    const processScope = await createCurrentProcessScope();
    const scopeA = await createCurrentAgentScope(processScope);
    const scopeB = await createCurrentAgentScope(processScope);
    try {
      const policyA: RetryPolicy = scopeA.require(capekRetryPolicyKey);
      const policyB: RetryPolicy = scopeB.require(capekRetryPolicyKey);
      expect(policyA).not.toBe(policyB);

      for (let i = 0; i < 3; i++) policyA.recordCircuitFailure('isolated:model');
      expect(policyA.openCircuitRemainingMs('isolated:model')).toBeGreaterThan(0);
      expect(policyB.openCircuitRemainingMs('isolated:model')).toBe(0);
      expect(policyB.recordCircuitFailure('isolated:model')).toBe(false);
    } finally {
      await scopeA.dispose();
      await scopeB.dispose();
      await processScope.dispose();
    }
  });

  test('the retry policy is an explicit required agent-scoped provider', async () => {
    const processScope = await createCurrentProcessScope();
    const plugins = currentAgentPlugins()
      .filter((plugin) => plugin.id !== 'current.retry-policy');
    const agentScope = await createAgentScope(processScope, [...plugins]);
    try {
      // Every other required service resolves; the missing retry policy is
      // what fails scope entry, with the exact kernel error.
      expect(() => enterAgentScope(agentScope, () => undefined))
        .toThrow(/service 'capek\.retry-policy' is not available/);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the unscoped process default is stable until the test-only reset', () => {
    const first = getRetryPolicy();
    expect(first.id).toBe('retry.process-default');
    expect(getRetryPolicy()).toBe(first);
    resetDefaultRetryPolicyForTests();
    expect(getRetryPolicy()).not.toBe(first);
  });
});

describe('C6 retry policy compatibility surface', () => {
  test('a policy overlay map keeps the exact CircuitState shape', () => {
    const state: Map<string, CircuitState> = createRetryCircuitState();
    state.set('p:m', { failures: 1, lastFailureAt: Date.now(), openUntil: 0 });
    expect(state.get('p:m')).toEqual({ failures: 1, lastFailureAt: expect.any(Number), openUntil: 0 });
  });
});
