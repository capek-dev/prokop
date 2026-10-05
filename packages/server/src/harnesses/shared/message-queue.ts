import type { SessionWirePorts } from '@/application/ports/delivery';
import type { SessionExecutionPort } from '@/application/ports/execution';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { deleteQueuedMessage, getNextQueuedMessage, getQueuedMessage } from '@/infrastructure/sqlite/queued-messages';
import { describeError, logHarness, type HarnessName } from './diagnostics';

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

/**
 * Errors reach only the prompting connection, which may already be gone for
 * queued prompts. Every error a turn sends is also written to the server log.
 */
function loggedWire<Origin>(
  wire: SessionWirePorts<Origin>, harness: HarnessName, sessionId: string, queued: boolean,
): SessionWirePorts<Origin> {
  const delivery = wire.delivery;
  return {
    actor: wire.actor,
    delivery: {
      send(origin, message) {
        if (message.type === 'error') {
          logHarness(harness, queued ? 'queued prompt failed' : 'prompt failed',
            { sessionId: message.sessionId ?? sessionId, code: message.code, message: message.message });
        }
        delivery.send(origin, message);
      },
      broadcast: (message, excludeOrigin) => delivery.broadcast(message, excludeOrigin),
      broadcastToSession: (id, message, excludeOrigin) => delivery.broadcastToSession(id, message, excludeOrigin),
      sendToController: (id, message) => delivery.sendToController(id, message),
      sendToAskTargets: (id, authority, message) => delivery.sendToAskTargets(id, authority, message),
    },
  };
}

/** CLI turns acknowledge persisted input and signal safe continuation only after cleanup. */
export function withCliMessageQueue(execution: CliTurnExecution, harness: HarnessName): QueuedCliExecution {
  const running = new Set<string>();

  async function send<Origin>(
    wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string, queued: boolean,
    content: string, attachments?: Array<{ id: string; kind: string }>, responseFormatId?: string,
    goalCondition?: string, goalMaxTurns?: number, goalTokenBudget?: number, queuedInput?: QueuedTurnInput,
  ): Promise<'drainable' | void> {
    try {
      return await execution.sendMessage(loggedWire(wire, harness, sessionId, queued), origin, sessionId, content,
        attachments, responseFormatId, goalCondition, goalMaxTurns, goalTokenBudget, queuedInput);
    } catch (error) {
      logHarness(harness, 'turn threw', { sessionId, queued, ...describeError(error) });
      throw error;
    }
  }

  async function drain<Origin>(wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string): Promise<void> {
    while (getSession(sessionId)?.status === 'active') {
      const next = getNextQueuedMessage(sessionId);
      if (!next) return;
      let accepted = false;
      const result = await send(wire, origin, sessionId, true, next.content, next.attachments,
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
      if (result !== 'drainable' || !accepted && getQueuedMessage(next.id)) {
        if (getQueuedMessage(next.id)) {
          logHarness(harness, 'queue stopped', { sessionId, queueId: next.id, accepted,
            reason: result === 'drainable' ? 'not accepted' : 'turn did not finish cleanly' });
        }
        return;
      }
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
        loggedWire(wire, harness, sessionId, false).delivery.send(origin, { type: 'error', code: 'invalid_session',
          sessionId, message: 'CLI turn already running' });
        return;
      }
      running.add(sessionId);
      try {
        const result = await send(wire, origin, sessionId, false, ...input);
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
