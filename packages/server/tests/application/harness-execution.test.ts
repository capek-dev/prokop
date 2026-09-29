import { expect, test } from 'bun:test';
import type { Session } from '@prokopai/sdk';
import type { SessionExecutionPort } from '@/application/ports/execution';
import type { SessionWirePorts } from '@/application/ports/delivery';
import { createHarnessExecution, type HarnessRegistration } from '@/application/sessions/harness-execution';
import { createClaudeCliHarness } from '@/harnesses/claude-cli';

function fixture() {
  const calls: string[] = [];
  const messages: unknown[] = [];
  const wire = { delivery: { send: (_origin: string, message: unknown) => { messages.push(message); } } } as unknown as SessionWirePorts<string>;
  const sessions: Record<string, Session> = {
    prokop: { id: 'prokop', harness: 'prokop' } as Session,
    legacy: { id: 'legacy' } as Session,
    codex: { id: 'codex', harness: 'codex-cli' } as Session,
    claude: { id: 'claude', harness: 'claude-cli' } as Session,
    unknown: { id: 'unknown', harness: 'other' } as unknown as Session,
    malformed: { id: 'malformed', harness: null } as unknown as Session,
  };
  const makeExecutor = (name: string): SessionExecutionPort => ({
    sendMessage: async () => { calls.push(`${name}:send`); },
    interruptSession: async id => {
      calls.push(`${name}:interrupt`);
      return { sessionId: id, success: true, cascadedTo: [], interruptedTools: [], rejectedAsks: [] };
    },
    isSessionActive: () => { calls.push(`${name}:active`); return true; },
    editMessage: async () => { calls.push(`${name}:edit`); },
    regenerateTitle: async () => { calls.push(`${name}:title`); },
    compact: async () => { calls.push(`${name}:compact`); return { ok: false, error: 'test' }; },
    revert: async () => { calls.push(`${name}:revert`); return { revertedTo: { messageId: null, messageCount: 0 }, removed: { messageIds: [], partCount: 0 } }; },
    fork: async () => { calls.push(`${name}:fork`); return { forkedSession: sessions.prokop, messages: [] }; },
  });
  const prokop = makeExecutor('prokop');
  const codexBase = makeExecutor('codex');
  const codex: HarnessRegistration = {
    execution: {
      sendMessage: codexBase.sendMessage,
      interruptSession: codexBase.interruptSession,
      isSessionActive: codexBase.isSessionActive,
      compact: codexBase.compact,
      fork: codexBase.fork,
    },
    unsupportedMessages: {
      editMessage: 'Editing is not supported for Codex CLI sessions',
      regenerateTitle: 'Title generation is not supported for Codex CLI sessions',
      revert: 'Revert is not supported for Codex CLI sessions',
    },
  };
  const execution = createHarnessExecution({ getSession: id => sessions[id] ?? null }, {
    prokop: { execution: prokop }, 'codex-cli': codex,
    'claude-cli': createClaudeCliHarness({
      sendMessage: async () => { calls.push('claude:send'); },
      interruptSession: codexBase.interruptSession,
      isSessionActive: codexBase.isSessionActive,
      compact: codexBase.compact,
      editMessage: async () => { calls.push('claude:edit'); },
      revert: async () => { calls.push('claude:revert'); return { revertedTo: { messageId: null, messageCount: 0 },
        removed: { messageIds: [], partCount: 0 } }; },
      fork: async () => { calls.push('claude:fork'); return { forkedSession: sessions.prokop, messages: [] }; },
    }),
  });
  return { execution, calls, messages, wire };
}

test('dispatches each operation by stored harness, including legacy Prokop identity', async () => {
  const { execution, calls, wire } = fixture();
  for (const id of ['prokop', 'legacy', 'codex']) {
    await execution.sendMessage(wire, 'origin', id, 'hello');
    await execution.interruptSession(id);
    expect(execution.isSessionActive(id)).toBe(true);
  }
  await execution.editMessage(wire, 'origin', { sessionId: 'legacy', messageId: 'm', content: 'edit' });
  await execution.regenerateTitle(wire, 'origin', 'prokop');
  await execution.compact('legacy', 'manual');
  await execution.revert({ sessionId: 'prokop', targetMessageId: 'm' });
  await execution.fork({ sessionId: 'prokop', targetMessageId: 'm' });
  expect(calls).toEqual([
    'prokop:send', 'prokop:interrupt', 'prokop:active',
    'prokop:send', 'prokop:interrupt', 'prokop:active',
    'codex:send', 'codex:interrupt', 'codex:active',
    'prokop:edit', 'prokop:title', 'prokop:compact', 'prokop:revert', 'prokop:fork',
  ]);
});

test('Claude Edit, Undo, and fork route to its harness without enabling title', async () => {
  const { execution, calls, wire, messages } = fixture();
  await execution.editMessage(wire, 'origin', { sessionId: 'claude', messageId: 'u', content: 'new text' });
  await execution.revert({ sessionId: 'claude', targetMessageId: 'a' });
  await execution.fork({ sessionId: 'claude', targetMessageId: 'a' });
  await execution.regenerateTitle(wire, 'origin', 'claude');
  expect(messages).toEqual([expect.objectContaining({ code: 'invalid_session', sessionId: 'claude',
    message: 'Claude CLI title generation is not supported' })]);
  expect(calls).toEqual(['claude:edit', 'claude:revert', 'claude:fork']);
});

test('Codex token budgets reject ambiguous and non-Codex sends before dispatch', async () => {
  const { execution, calls, wire, messages } = fixture();
  await execution.sendMessage(wire, 'origin', 'prokop', 'goal', undefined, undefined, 'goal', undefined, 100);
  await execution.sendMessage(wire, 'origin', 'codex', 'goal', undefined, undefined, 'goal', 5, 100);
  await execution.sendMessage(wire, 'origin', 'codex', 'chat', undefined, undefined, undefined, undefined, 100);
  expect(calls).toEqual([]);
  expect(messages).toEqual([
    expect.objectContaining({ code: 'invalid_session', message: 'Token budgets require a Codex session' }),
    expect.objectContaining({ code: 'invalid_session', message: 'A Codex token budget requires a goal and cannot use max turns' }),
    expect.objectContaining({ code: 'invalid_session', message: 'A Codex token budget requires a goal and cannot use max turns' }),
  ]);
  await execution.sendMessage(wire, 'origin', 'codex', 'goal', undefined, undefined, 'goal', undefined, 100);
  expect(calls).toEqual(['codex:send']);
});

test('Claude Goal dispatches its condition without Codex limits', async () => {
  const { execution, calls, wire, messages } = fixture();
  await execution.sendMessage(wire, 'origin', 'claude', 'tests pass', undefined, undefined, 'tests pass');
  await execution.sendMessage(wire, 'origin', 'claude', 'tests pass', undefined, undefined, 'tests pass', undefined, 100);
  expect(calls).toEqual(['claude:send']);
  expect(messages).toMatchObject([{ type: 'error', code: 'invalid_session', sessionId: 'claude' }]);
});

test('Codex compact dispatches while unsupported operations still refuse without reaching Prokop', async () => {
  const { execution, calls, wire, messages } = fixture();
  await execution.editMessage(wire, 'origin', { sessionId: 'codex', messageId: 'm', content: 'edit' });
  await execution.regenerateTitle(wire, 'origin', 'codex');
  expect(messages).toEqual([
    { type: 'error', code: 'invalid_session', sessionId: 'codex', message: 'Editing is not supported for Codex CLI sessions' },
    { type: 'error', code: 'invalid_session', sessionId: 'codex', message: 'Title generation is not supported for Codex CLI sessions' },
  ]);
  expect(await execution.compact('codex', 'manual')).toEqual({ ok: false, error: 'test' });
  expect(execution.revert({ sessionId: 'codex', targetMessageId: 'm' })).rejects.toThrow('Revert is not supported for Codex CLI sessions');
  await execution.fork({ sessionId: 'codex', targetMessageId: 'm' });
  expect(calls).toEqual(['codex:compact', 'codex:fork']);
});

test('missing or unknown owners fail closed for every execution route', async () => {
  const { execution, calls, wire, messages } = fixture();
  for (const id of ['missing', 'unknown', 'malformed']) {
    await execution.sendMessage(wire, 'origin', id, 'hello');
    expect(await execution.interruptSession(id)).toMatchObject({ success: false, sessionId: id });
    expect(execution.isSessionActive(id)).toBe(false);
    await execution.editMessage(wire, 'origin', { sessionId: id, messageId: 'm', content: 'edit' });
    await execution.regenerateTitle(wire, 'origin', id);
    expect(await execution.compact(id, 'manual')).toMatchObject({ ok: false, skipped: true });
    expect(execution.revert({ sessionId: id, targetMessageId: 'm' })).rejects.toThrow();
    expect(execution.fork({ sessionId: id, targetMessageId: 'm' })).rejects.toThrow();
  }
  expect(messages).toEqual([
    ...Array.from({ length: 3 }, () => expect.objectContaining({ code: 'invalid_session', message: 'Session not found', sessionId: 'missing' })),
    ...Array.from({ length: 3 }, () => expect.objectContaining({ code: 'invalid_session', message: 'Unknown session harness', sessionId: 'unknown' })),
    ...Array.from({ length: 3 }, () => expect.objectContaining({ code: 'invalid_session', message: 'Unknown session harness', sessionId: 'malformed' })),
  ]);
  expect(calls).toEqual([]);
});
