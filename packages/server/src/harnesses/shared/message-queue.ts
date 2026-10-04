import type { SessionWirePorts } from '@/application/ports/delivery';
import type { SessionExecutionPort } from '@/application/ports/execution';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { deleteQueuedMessage, getNextQueuedMessage, getQueuedMessage } from '@/infrastructure/sqlite/queued-messages';

export interface QueuedTurnInput {
  isPending(): boolean;
  accepted(): void;
}

export type QueuedCliExecution = Pick<SessionExecutionPort,
  'sendMessage' | 'drainQueue' | 'interruptSession' | 'isSessionActive' | 'editMessage' | 'revert' | 'fork' | 'compact'>;

export interface CliTurnExecution extends Omit<QueuedCliExecution, 'sendMessage' | 'drainQueue'> {
  sendMessage<Origin>(
    wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string,
    content: string, attachments?: Array<{ id: string; kind: string }>, responseFormatId?: string,
    goalCondition?: string, goalMaxTurns?: number, goalTokenBudget?: number,
    queued?: QueuedTurnInput,
  ): Promise<'drainable' | void>;
}

/** CLI turns acknowledge persisted input and signal safe continuation only after cleanup. */
export function withCliMessageQueue(execution: CliTurnExecution): QueuedCliExecution {
  const running = new Set<string>();

  async function drain<Origin>(wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string): Promise<void> {
    while (getSession(sessionId)?.status === 'active') {
      const next = getNextQueuedMessage(sessionId);
      if (!next) return;
      let accepted = false;
      const result = await execution.sendMessage(wire, origin, sessionId, next.content, next.attachments,
        undefined, undefined, undefined, undefined, {
          isPending: () => getQueuedMessage(next.id) !== null && getSession(sessionId)?.status === 'active',
          accepted: () => {
            accepted = true;
            // Input is already persisted. Never replay it if delivery subsequently fails.
            try {
              wire.delivery.broadcastToSession(sessionId, { type: 'queue.sending', sessionId, queueId: next.id });
            } finally {
              deleteQueuedMessage(next.id);
            }
          },
        });
      if (result !== 'drainable' || !accepted && getQueuedMessage(next.id)) return;
    }
  }

  const queuedExecution: QueuedCliExecution = {
    ...execution,
    isSessionActive: sessionId => running.has(sessionId) || execution.isSessionActive(sessionId),
    async editMessage(wire, origin, input) {
      if (running.has(input.sessionId)) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', sessionId: input.sessionId,
          message: 'CLI turn already running' });
        return;
      }
      await execution.editMessage.call(queuedExecution, wire, origin, input);
    },
    async compact(sessionId, reason, delivery) {
      if (running.has(sessionId)) return { ok: false, skipped: true, error: 'CLI turn already running' };
      return execution.compact(sessionId, reason, delivery);
    },
    async revert(input) {
      if (running.has(input.sessionId)) throw new Error('CLI turn already running');
      return execution.revert(input);
    },
    async fork(input) {
      if (running.has(input.sessionId)) throw new Error('CLI turn already running');
      return execution.fork(input);
    },
    async sendMessage(wire, origin, sessionId, ...input) {
      if (running.has(sessionId)) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', sessionId,
          message: 'CLI turn already running' });
        return;
      }
      running.add(sessionId);
      try {
        const result = await execution.sendMessage(wire, origin, sessionId, ...input);
        if (result === 'drainable') await drain(wire, origin, sessionId);
      } finally {
        running.delete(sessionId);
      }
    },
    async drainQueue(wire, origin, sessionId) {
      if (running.has(sessionId) || execution.isSessionActive(sessionId)) return;
      running.add(sessionId);
      try {
        await drain(wire, origin, sessionId);
      } finally {
        running.delete(sessionId);
      }
    },
  };
  return queuedExecution;
}
