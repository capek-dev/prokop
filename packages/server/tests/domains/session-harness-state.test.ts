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
});
