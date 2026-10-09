import { describe, expect, test } from 'vitest';
import type { AssistantMessage } from '@prokopai/sdk';
import {
  firstLine,
  formatDuration,
  formatElapsed,
  getInterruptReasonLabel,
  getToolDurationMs,
  getTurnMeta,
} from '@/lib/turnStats';

function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: 'a', sessionId: 's', role: 'assistant', status: 'completed', createdAt: 1_000,
    modelId: 'model-x', providerId: 'p', tokens: { prompt: 0, completion: 0 }, cost: 0,
    ...overrides,
  };
}

describe('duration formatting', () => {
  test('finished durations keep a decimal below ten seconds', () => {
    expect(formatDuration(420)).toBe('0.4s');
    expect(formatDuration(9_940)).toBe('9.9s');
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(102_000)).toBe('1m 42s');
    expect(formatDuration(3_720_000)).toBe('1h 2m');
  });

  test('live timers use whole seconds and never go negative under clock skew', () => {
    expect(formatElapsed(1_999)).toBe('1s');
    expect(formatElapsed(-500)).toBe('0s');
  });
});

describe('turn meta', () => {
  test('shows model, duration and tokens, never cost', () => {
    // Claude Code reports an API-price estimate even on subscriptions.
    const meta = getTurnMeta(assistant({
      completedAt: 103_000,
      tokens: { prompt: 17_000, completion: 1_200, cacheRead: 9_000 },
      cost: 10.17,
    }));
    expect(meta).toEqual({
      model: 'model-x',
      duration: '1m 42s',
      tokens: '18.2k tok',
      tokensTitle: '17.0k in · 1.2k out · 9.0k cache read',
    });
  });

  test('hides values harnesses never recorded', () => {
    // Codex stores zero tokens; an unfinished turn has no completedAt.
    expect(getTurnMeta(assistant())).toEqual({ model: 'model-x' });
  });

  test('a streaming turn has no duration yet', () => {
    expect(getTurnMeta(assistant({ status: 'streaming', completedAt: 5_000 })).duration).toBeUndefined();
  });
});

describe('tool state helpers', () => {
  test('duration covers every finished status and none while running', () => {
    expect(getToolDurationMs({ status: 'completed', input: {}, output: null, startedAt: 10, completedAt: 40 })).toBe(30);
    expect(getToolDurationMs({ status: 'error', input: {}, error: 'x', startedAt: 10, failedAt: 15 })).toBe(5);
    expect(getToolDurationMs({ status: 'interrupted', input: {}, startedAt: 10, interruptedAt: 12, reason: 'timeout' })).toBe(2);
    expect(getToolDurationMs({ status: 'running', input: {}, startedAt: 10 })).toBeUndefined();
  });

  test('interrupt reasons read as plain words', () => {
    expect(getInterruptReasonLabel({ status: 'interrupted', input: {}, startedAt: 1, interruptedAt: 2, reason: 'user_request' }))
      .toBe('stopped');
    expect(getInterruptReasonLabel({ status: 'running', input: {}, startedAt: 1 })).toBeUndefined();
  });

  test('first line skips leading blank lines', () => {
    expect(firstLine('\n  ENOENT: no such file\nstack...')).toBe('ENOENT: no such file');
  });
});
