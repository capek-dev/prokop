import { describe, expect, spyOn, test } from 'bun:test';
import type { SessionWirePorts } from '@/application/ports/delivery';
import { persistCliSessionRunning, withCliMessageQueue, type CliRunningFlag } from '@/harnesses/shared/message-queue';
import { addMessageToQueue } from '@/infrastructure/sqlite/queued-messages';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';

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
  }, 'claude-cli', () => {});
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

function queueWith(
  sendMessage: Parameters<typeof withCliMessageQueue>[0]['sendMessage'],
  markRunning: CliRunningFlag = () => {},
) {
  return withCliMessageQueue({
    sendMessage,
    isSessionActive: () => false,
    interruptSession: async sessionId => ({ sessionId, success: false, cascadedTo: [], interruptedTools: [], rejectedAsks: [] }),
    editMessage: async () => {},
    compact: async () => { throw new Error('unused'); },
    revert: async () => { throw new Error('unused'); },
    fork: async () => { throw new Error('unused'); },
  }, 'codex-cli', markRunning);
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

describe('CLI sessions are flagged running for every client', () => {
  const quietWire: SessionWirePorts<string> = {
    delivery: { send: () => {}, broadcast: () => {}, broadcastToSession: () => {}, sendToController: () => {}, sendToAskTargets: () => {} },
    actor: { attachOriginToSession: () => {} },
  };
  const recorder = () => {
    const flags: Array<[string, boolean]> = [];
    const markRunning: CliRunningFlag = (_wire, sessionId, running) => { flags.push([sessionId, running]); };
    return { flags, markRunning };
  };

  // rest after content: attachments, responseFormatId, goalCondition, goalMaxTurns, goalTokenBudget, queued, started
  test('from the start of a turn until it ends', async () => {
    let finish!: () => void;
    const turnDone = new Promise<void>(resolve => { finish = resolve; });
    const { flags, markRunning } = recorder();
    const execution = queueWith(async (_wire, _origin, _sessionId, _content, ...rest) => {
      rest[6]?.();
      await turnDone;
    }, markRunning);

    const turn = execution.sendMessage(quietWire, 'origin', 'session', 'hello');
    expect(flags).toEqual([['session', true]]);
    finish();
    await turn;
    expect(flags).toEqual([['session', true], ['session', false]]);
  });

  test('a prompt rejected before its turn starts never flags the session', async () => {
    const { flags, markRunning } = recorder();
    const execution = queueWith(async (turnWire, origin, sessionId) => {
      turnWire.delivery.send(origin, { type: 'error', code: 'invalid_session', sessionId, message: 'invalid image' });
    }, markRunning);
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await execution.sendMessage(quietWire, 'origin', 'session', 'hello');
    } finally {
      warn.mockRestore();
    }
    expect(flags).toEqual([]);
  });

  test('a failing flag write is logged and never fails the turn', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let ran = false;
      const execution = queueWith(async (_wire, _origin, _sessionId, _content, ...rest) => {
        rest[6]?.();
        ran = true;
      }, () => { throw new Error('database is locked'); });
      await execution.sendMessage(quietWire, 'origin', 'session', 'hello');
      expect(ran).toBe(true);
      expect(warn).toHaveBeenCalledWith('[codex-cli] running flag update failed',
        expect.objectContaining({ sessionId: 'session', running: true, error: 'database is locked' }));
    } finally {
      warn.mockRestore();
    }
  });

  test('queued turns share one running span and an empty drain leaves the flag alone', async () => {
    setupTestDatabase();
    try {
      const { sessionId } = seedWorkspaceWithSession({ id: 'ws-flag' }, { status: 'active' });
      addMessageToQueue(sessionId, 'queued one');
      addMessageToQueue(sessionId, 'queued two');
      const turns: string[] = [];
      const { flags, markRunning } = recorder();
      const execution = queueWith(async (_wire, _origin, _sessionId, content, ...rest) => {
        turns.push(content);
        rest[5]?.accepted();
        rest[6]?.();
        return 'drainable';
      }, markRunning);

      await execution.sendMessage(quietWire, 'origin', sessionId, 'first');
      expect(turns).toEqual(['first', 'queued one', 'queued two']);
      expect(flags).toEqual([[sessionId, true], [sessionId, false]]);

      await execution.drainQueue?.(quietWire, 'origin', sessionId);
      expect(flags).toHaveLength(2);
    } finally {
      resetTestDatabase();
    }
  });

  test('the stored flag is what session lists read, broadcast to all clients', () => {
    setupTestDatabase();
    try {
      const { sessionId } = seedWorkspaceWithSession({ id: 'ws-flag-store' });
      const broadcasts: unknown[] = [];
      const wire = { delivery: { broadcast: (message: unknown) => { broadcasts.push(message); } } } as unknown as SessionWirePorts<string>;

      persistCliSessionRunning(wire, sessionId, true);
      expect(getSession(sessionId)?.runningAt).toEqual(expect.any(String));
      expect(broadcasts).toEqual([{ type: 'session.updated',
        session: expect.objectContaining({ id: sessionId, runningAt: expect.any(String) }) }]);

      persistCliSessionRunning(wire, sessionId, false);
      expect(getSession(sessionId)?.runningAt ?? null).toBeNull();
      expect(broadcasts[1]).toEqual({ type: 'session.updated', session: expect.objectContaining({ id: sessionId, runningAt: null }) });
    } finally {
      resetTestDatabase();
    }
  });
});
