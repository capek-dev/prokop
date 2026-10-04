import { expect, test } from 'bun:test';
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
  });
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
