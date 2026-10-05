import { expect, spyOn, test } from 'bun:test';
import type { SessionWirePorts } from '@/application/ports/delivery';
import { withCliMessageQueue } from '@/harnesses/shared/message-queue';

test('queue ownership keeps history operations blocked until native cleanup finishes', async () => {
  let finish!: () => void;
  const cleanup = new Promise<void>(resolve => { finish = resolve; });
  const events: unknown[] = [];
  const wire = { delivery: { send: (_origin: string, event: unknown) => { events.push(event); } } } as unknown as SessionWirePorts<string>;
  const execution = withCliMessageQueue({
    sendMessage: async () => { await cleanup; },
    // Native execution already cleared its live turn, but cleanup is still awaiting IO.
    isSessionActive: () => false,
    interruptSession: async sessionId => ({ sessionId, success: false, cascadedTo: [], interruptedTools: [], rejectedAsks: [] }),
    editMessage: async () => { throw new Error('must not edit'); },
    compact: async () => { throw new Error('must not compact'); },
    revert: async () => { throw new Error('must not revert'); },
    fork: async () => { throw new Error('must not fork'); },
  }, 'claude-cli');
  const turn = execution.sendMessage(wire, 'origin', 'session', 'first');
  try {
    expect(execution.isSessionActive('session')).toBe(true);
    await execution.editMessage(wire, 'origin', { sessionId: 'session', messageId: 'message', content: 'edited' });
    expect(events).toEqual([expect.objectContaining({ type: 'error', message: 'CLI turn already running' })]);
    expect(await execution.compact('session', 'manual')).toMatchObject({ ok: false, skipped: true });
    await expect(execution.revert({ sessionId: 'session', targetMessageId: 'message' })).rejects.toThrow('CLI turn already running');
    await expect(execution.fork({ sessionId: 'session', targetMessageId: 'message' })).rejects.toThrow('CLI turn already running');
    await execution.drainQueue?.(wire, 'origin', 'session');
  } finally {
    finish();
    await turn;
  }
  expect(execution.isSessionActive('session')).toBe(false);
});

function queueWith(sendMessage: Parameters<typeof withCliMessageQueue>[0]['sendMessage']) {
  return withCliMessageQueue({
    sendMessage,
    isSessionActive: () => false,
    interruptSession: async sessionId => ({ sessionId, success: false, cascadedTo: [], interruptedTools: [], rejectedAsks: [] }),
    editMessage: async () => {},
    compact: async () => { throw new Error('unused'); },
    revert: async () => { throw new Error('unused'); },
    fork: async () => { throw new Error('unused'); },
  }, 'codex-cli');
}

test('errors a turn sends to its connection are also written to the server log', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const events: unknown[] = [];
    const wire = { delivery: { send: (_origin: string, event: unknown) => { events.push(event); } } } as unknown as SessionWirePorts<string>;
    const execution = queueWith(async (turnWire, origin, sessionId) => {
      turnWire.delivery.send(origin, { type: 'error', code: 'invalid_session', sessionId,
        message: 'Codex thread binding is unavailable or changed' });
    });
    await execution.sendMessage(wire, 'origin', 'session', 'hello');
    expect(events).toEqual([expect.objectContaining({ message: 'Codex thread binding is unavailable or changed' })]);
    expect(warn).toHaveBeenCalledWith('[codex-cli] prompt failed', { sessionId: 'session', code: 'invalid_session',
      message: 'Codex thread binding is unavailable or changed' });
  } finally {
    warn.mockRestore();
  }
});

test('a turn that throws is logged with its error before rethrowing', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const wire = { delivery: { send: () => {} } } as unknown as SessionWirePorts<string>;
    const execution = queueWith(async () => { throw new TypeError('stream closed'); });
    await expect(execution.sendMessage(wire, 'origin', 'session', 'hello')).rejects.toThrow('stream closed');
    expect(warn).toHaveBeenCalledWith('[codex-cli] turn threw',
      expect.objectContaining({ sessionId: 'session', queued: false, errorType: 'TypeError', error: 'stream closed' }));
  } finally {
    warn.mockRestore();
  }
});
