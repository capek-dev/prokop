import { describe, expect, test } from 'bun:test';
import { deriveSessionHarnessState } from '@/domains/sessions/harness-state';

describe('session harness state derivation', () => {
  test('prokop and missing-harness sessions derive the neutral defaults', () => {
    const neutral = deriveSessionHarnessState('prokop', { anything: true });
    const legacy = deriveSessionHarnessState(undefined, null);
    for (const state of [neutral, legacy]) {
      expect(state.compaction).toEqual({ pending: false, uncertain: false, boundaryMessageId: null });
      expect(state.fork).toEqual({ mode: 'any' });
      expect(state.goalUncertain).toBe(false);
      expect(state.nativeApprovalPrefix).toBeUndefined();
      expect(state.capabilities).toEqual({
        canRemoveQueuedMessages: true,
        canInterruptSubagent: false,
        subagentActivityPropagates: false,
      });
    }
  });

  test('codex maps its compact-pending flag, boundary, and restrictions', () => {
    const idle = deriveSessionHarnessState('codex-cli', null);
    expect(idle.compaction.pending).toBe(false);
    expect(idle.fork).toEqual({ mode: 'assistant-only' });
    expect(idle.nativeApprovalPrefix).toBe('codex-approval:');
    expect(idle.capabilities.canRemoveQueuedMessages).toBe(false);
    expect(idle.capabilities.canInterruptSubagent).toBe(true);
    expect(idle.capabilities.subagentActivityPropagates).toBe(true);

    const pending = deriveSessionHarnessState('codex-cli', {
      codexCompactPending: true,
      codexCompactedAfterMessageId: 'm-7',
    });
    expect(pending.compaction).toEqual({ pending: true, uncertain: false, boundaryMessageId: 'm-7' });
  });

  test('claude maps compact-uncertain, goal-uncertain, and fork restrictions', () => {
    const idle = deriveSessionHarnessState('claude-cli', null);
    expect(idle.compaction.uncertain).toBe(false);
    expect(idle.fork).toEqual({ mode: 'any' });
    expect(idle.goalUncertain).toBe(false);
    expect(idle.nativeApprovalPrefix).toBe('claude-approval:');
    expect(idle.capabilities.canRemoveQueuedMessages).toBe(true);

    const uncertain = deriveSessionHarnessState('claude-cli', {
      claudeCompactPending: true,
      claudeCompactedAfterMessageId: 'm-9',
    });
    expect(uncertain.compaction).toEqual({ pending: false, uncertain: true, boundaryMessageId: 'm-9' });
    expect(uncertain.fork).toEqual({ mode: 'restricted', reason: 'Fork unavailable: compaction outcome uncertain' });

    const afterGoal = deriveSessionHarnessState('claude-cli', { claudeGoal: { status: 'met' } });
    expect(afterGoal.fork).toEqual({ mode: 'restricted', reason: 'Fork unavailable after Goal or Compact' });
    expect(afterGoal.goalUncertain).toBe(false);

    const goalUncertain = deriveSessionHarnessState('claude-cli', { claudeGoal: { status: 'uncertain' } });
    expect(goalUncertain.goalUncertain).toBe(true);
  });

  test('non-object metadata cannot crash the derivation', () => {
    expect(deriveSessionHarnessState('codex-cli', 'nope' as unknown as Record<string, unknown>).compaction.pending)
      .toBe(false);
    expect(deriveSessionHarnessState('claude-cli', [1, 2] as unknown as Record<string, unknown>).fork.mode)
      .toBe('any');
  });

  test('codex goal and usage derive from metadata', () => {
    const state = deriveSessionHarnessState('codex-cli', {
      codexGoal: { status: 'active', objective: 'Ship it', tokenBudget: 50000, tokensUsed: 123 },
      codexUsage: {
        last: { inputTokens: 9500, outputTokens: 2500, totalTokens: 12000 },
        total: { totalTokens: 48000 },
        modelContextWindow: 200000,
      },
    });
    expect(state.goal).toEqual({
      status: 'active', objective: 'Ship it',
      progress: { kind: 'tokens', current: 123, max: 50000 },
    });
    expect(state.usage).toMatchObject({ used: 12000, contextWindow: 200000 });
    expect(state.usage?.rows.map(row => row.label)).toEqual(['Latest input', 'Latest output', 'Thread total', 'Context window']);
  });

  test('claude goal and usage derive from metadata with context occupancy', () => {
    const state = deriveSessionHarnessState('claude-cli', {
      claudeGoal: { status: 'active', condition: 'Tests pass', iterations: 3 },
      claudeUsage: { last: { prompt: 1200, completion: 100, cacheRead: 400, cacheWrite: 200 } },
      claudeContext: { used: 50000, window: 200000 },
    });
    expect(state.goal).toEqual({
      status: 'active', objective: 'Tests pass',
      progress: { kind: 'iterations', current: 3, max: null },
    });
    expect(state.usage).toEqual({
      used: 50000, contextWindow: 200000,
      rows: [
        { label: 'Latest input', value: '1,200' },
        { label: 'Latest output', value: '100' },
        { label: 'Latest cached input', value: '400' },
        { label: 'Latest cache creation', value: '200' },
        { label: 'Context', value: '50,000 / 200,000' },
      ],
    });
  });

  test('malformed goal and usage metadata derive to null', () => {
    const state = deriveSessionHarnessState('codex-cli', {
      codexGoal: 'nonsense',
      codexUsage: 42,
    });
    expect(state.goal).toBeNull();
    expect(state.usage).toBeNull();
  });

  test('prokop usage derives from session token totals', () => {
    expect(deriveSessionHarnessState('prokop', null, {
      promptTokens: 4200, completionTokens: 800, totalTokens: 5000,
    }).usage).toMatchObject({ used: 5000, contextWindow: 0 });

    expect(deriveSessionHarnessState('prokop', null, { totalTokens: 0 }).usage).toBeNull();
    expect(deriveSessionHarnessState('prokop', null).usage).toBeNull();
  });
});
