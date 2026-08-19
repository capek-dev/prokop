import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { StepPart } from '@jean2/sdk';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { createMessage } from '@/infrastructure/sqlite/message-store';
import { createStepCallbacks, type StepCallbacksContext } from '@capekai/core/execution';

describe('step-handlers', () => {
  let sessionId: string;
  let messageId: string;

  beforeEach(() => {
    setupTestDatabase();
    const { sessionId: sid } = seedWorkspaceWithSession();
    sessionId = sid;
    messageId = 'msg-1';
    createMessage({
      id: messageId,
      sessionId,
      role: 'assistant',
      createdAt: Date.now(),
      status: 'streaming',
      modelId: 'gpt-4o',
      providerId: 'openai',
      tokens: { prompt: 0, completion: 0 },
      cost: 0,
    });
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function createContext(overrides: Partial<StepCallbacksContext> = {}): StepCallbacksContext {
    return {
      messageId,
      sessionId,
      stepParts: [],
      yieldFn: null,
      isMainSession: true,
      contextWindow: 128000,
      autoThreshold: 100000,
      resolvedModelId: 'gpt-4o',
      variant: undefined,
      needsCompaction: false,
      latestUsage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        noCacheTokens: 0,
      },
      ...overrides,
    };
  }

  // ── experimental_onStepStart ─────────────────────────────────

  describe('experimental_onStepStart', () => {
    test('creates step part with started status', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);

      callbacks.experimental_onStepStart({ stepNumber: 0 });

      expect(ctx.stepParts).toHaveLength(1);
      expect(ctx.stepParts[0].status).toBe('started');
      expect(ctx.stepParts[0].number).toBe(1);
    });

    test('increments step number (stepNumber + 1)', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);

      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.experimental_onStepStart({ stepNumber: 1 });

      expect(ctx.stepParts).toHaveLength(2);
      expect(ctx.stepParts[0].number).toBe(1);
      expect(ctx.stepParts[1].number).toBe(2);
    });

    test('step part has correct message and session ids', () => {
      const ctx = createContext({ messageId: 'msg-1' });
      const callbacks = createStepCallbacks(ctx);

      callbacks.experimental_onStepStart({ stepNumber: 0 });

      expect(ctx.stepParts[0].messageId).toBe('msg-1');
    });
  });

  // ── onStepFinish ─────────────────────────────────────────────

  describe('onStepFinish', () => {
    test('updates existing step part to finished status', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);

      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({
        stepNumber: 0,
        finishReason: 'stop',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      });

      expect(ctx.stepParts).toHaveLength(1);
      expect(ctx.stepParts[0].status).toBe('finished');
      expect(ctx.stepParts[0].finishReason).toBe('stop');
    });

    test('sets token counts from usage', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);

      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({
        stepNumber: 0,
        finishReason: 'stop',
        usage: {
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
          inputTokenDetails: {
            cacheReadTokens: 120,
            cacheWriteTokens: 10,
            noCacheTokens: 80,
          },
        },
      });

      const step = ctx.stepParts[0] as StepPart;
      expect(step.tokens).toEqual({
        prompt: 200,
        completion: 100,
        cacheRead: 120,
        cacheWrite: 10,
        noCache: 80,
      });
    });

    test('defaults token counts to 0 when no usage', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);

      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({ stepNumber: 0, finishReason: 'stop' });

      const step = ctx.stepParts[0] as StepPart;
      expect(step.tokens).toEqual({
        prompt: 0,
        completion: 0,
        cacheRead: 0,
        cacheWrite: 0,
        noCache: 0,
      });
    });

    test('maps finishReason stop correctly', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);
      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({ stepNumber: 0, finishReason: 'stop' });
      expect(ctx.stepParts[0].finishReason).toBe('stop');
    });

    test('maps finishReason tool-calls correctly', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);
      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({ stepNumber: 0, finishReason: 'tool-calls' });
      expect(ctx.stepParts[0].finishReason).toBe('tool-calls');
    });

    test('maps finishReason length correctly', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);
      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({ stepNumber: 0, finishReason: 'length' });
      expect(ctx.stepParts[0].finishReason).toBe('length');
    });

    test('maps finishReason error correctly', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);
      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({ stepNumber: 0, finishReason: 'error' });
      expect(ctx.stepParts[0].finishReason).toBe('error');
    });

    test('maps finishReason other to error', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);
      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({ stepNumber: 0, finishReason: 'other' });
      expect(ctx.stepParts[0].finishReason).toBe('error');
    });

    test('leaves finishReason undefined for null finishReason', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);
      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({ stepNumber: 0, finishReason: null });
      expect(ctx.stepParts[0].finishReason).toBeUndefined();
    });

    test('creates new step part if no matching start part exists', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);

      callbacks.onStepFinish({
        stepNumber: 0,
        finishReason: 'stop',
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
      });

      expect(ctx.stepParts).toHaveLength(1);
      expect(ctx.stepParts[0].status).toBe('finished');
    });

    test('updates latestUsage in context when usage provided', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);

      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({
        stepNumber: 0,
        finishReason: 'stop',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          inputTokenDetails: {
            cacheReadTokens: 60,
            cacheWriteTokens: 5,
            noCacheTokens: 40,
          },
        },
      });

      expect(ctx.latestUsage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cacheReadTokens: 60,
        cacheWriteTokens: 5,
        noCacheTokens: 40,
      });
    });

    test('does not update latestUsage when no usage', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);

      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({ stepNumber: 0, finishReason: 'stop' });

      expect(ctx.latestUsage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        noCacheTokens: 0,
      });
    });
  });

  // ── Compaction threshold ─────────────────────────────────────

  describe('compaction threshold detection', () => {
    test('sets needsCompaction when main session input tokens exceed threshold', () => {
      const ctx = createContext({
        sessionId,
        isMainSession: true,
        contextWindow: 128000,
        autoThreshold: 100000,
      });
      const callbacks = createStepCallbacks(ctx);

      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({
        stepNumber: 0,
        finishReason: 'stop',
        usage: { inputTokens: 110000, outputTokens: 50, totalTokens: 110050 },
      });

      expect(ctx.needsCompaction).toBe(true);
    });

    test('does not set needsCompaction when tokens below threshold', () => {
      const ctx = createContext({
        sessionId,
        isMainSession: true,
        contextWindow: 128000,
        autoThreshold: 100000,
      });
      const callbacks = createStepCallbacks(ctx);

      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({
        stepNumber: 0,
        finishReason: 'stop',
        usage: { inputTokens: 50000, outputTokens: 50, totalTokens: 50050 },
      });

      expect(ctx.needsCompaction).toBe(false);
    });

    test('does not set needsCompaction for non-main sessions', () => {
      const ctx = createContext({
        sessionId,
        isMainSession: false,
        contextWindow: 128000,
        autoThreshold: 100000,
      });
      const callbacks = createStepCallbacks(ctx);

      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({
        stepNumber: 0,
        finishReason: 'stop',
        usage: { inputTokens: 110000, outputTokens: 50, totalTokens: 110050 },
      });

      expect(ctx.needsCompaction).toBe(false);
    });

    test('does not set needsCompaction when contextWindow is undefined', () => {
      const ctx = createContext({
        sessionId,
        isMainSession: true,
        contextWindow: undefined,
        autoThreshold: 100000,
      });
      const callbacks = createStepCallbacks(ctx);

      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({
        stepNumber: 0,
        finishReason: 'stop',
        usage: { inputTokens: 110000, outputTokens: 50, totalTokens: 110050 },
      });

      expect(ctx.needsCompaction).toBe(false);
    });

    test('sets needsCompaction when tokens exactly equal threshold', () => {
      const ctx = createContext({
        sessionId,
        isMainSession: true,
        contextWindow: 128000,
        autoThreshold: 100000,
      });
      const callbacks = createStepCallbacks(ctx);

      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({
        stepNumber: 0,
        finishReason: 'stop',
        usage: { inputTokens: 100000, outputTokens: 50, totalTokens: 100050 },
      });

      expect(ctx.needsCompaction).toBe(true);
    });
  });

  // ── Multi-step flow ──────────────────────────────────────────

  describe('multi-step flow', () => {
    test('tracks multiple steps correctly', () => {
      const ctx = createContext();
      const callbacks = createStepCallbacks(ctx);

      callbacks.experimental_onStepStart({ stepNumber: 0 });
      callbacks.onStepFinish({
        stepNumber: 0,
        finishReason: 'tool-calls',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      });

      callbacks.experimental_onStepStart({ stepNumber: 1 });
      callbacks.onStepFinish({
        stepNumber: 1,
        finishReason: 'stop',
        usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
      });

      expect(ctx.stepParts).toHaveLength(2);
      expect(ctx.stepParts[0].number).toBe(1);
      expect(ctx.stepParts[0].status).toBe('finished');
      expect(ctx.stepParts[0].finishReason).toBe('tool-calls');
      expect(ctx.stepParts[1].number).toBe(2);
      expect(ctx.stepParts[1].status).toBe('finished');
      expect(ctx.stepParts[1].finishReason).toBe('stop');

      expect(ctx.latestUsage).toEqual({
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        noCacheTokens: 0,
      });
    });
  });
});
