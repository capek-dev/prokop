import type { SessionWirePorts } from '../ports/delivery';
import type { ControllerGatePort } from '../ports/control';
import type { SessionRepositoryPort } from '../ports/session';
import { sendGateRejection } from './chat';

export interface SessionQueueDeps<Origin> {
  repository: SessionRepositoryPort;
  gate: ControllerGatePort<Origin>;
}

export interface SessionQueueApplication<Origin> {
  add(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    input: { sessionId: string; content: string; attachments?: Array<{ id: string; kind: string }> },
  ): void;
  remove(wire: SessionWirePorts<Origin>, origin: Origin, queueId: string): void;
}

export function createSessionQueueApplication<Origin>(
  deps: SessionQueueDeps<Origin>,
): SessionQueueApplication<Origin> {
  return {
    add(wire, origin, input): void {
      const sessionId = input.sessionId;
      const session = deps.repository.getSession(sessionId);
      if (!session) {
        wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Session not found' });
        return;
      }
      const gate = deps.gate.checkControllerGate(sessionId, 'queue.add', origin);
      if (gate) {
        sendGateRejection(wire, origin, gate);
        return;
      }

      if (!input.content || !input.content.trim()) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_content', message: 'Content cannot be empty' });
        return;
      }

      const queuedMessage = deps.repository.addMessageToQueue(sessionId, input.content, input.attachments);
      wire.actor.attachOriginToSession(origin, sessionId);

      wire.delivery.send(origin, {
        type: 'queue.added',
        sessionId,
        message: queuedMessage,
      });
    },

    remove(wire, origin, queueId): void {
      const queuedMsg = deps.repository.getQueuedMessage(queueId);
      if (!queuedMsg) {
        wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Queued message not found' });
        return;
      }
      const gate = deps.gate.checkControllerGate(queuedMsg.sessionId, 'queue.remove', origin);
      if (gate) {
        sendGateRejection(wire, origin, gate);
        return;
      }

      deps.repository.deleteQueuedMessage(queueId);

      wire.delivery.send(origin, {
        type: 'queue.removed',
        sessionId: queuedMsg.sessionId,
        queueId,
      });
    },
  };
}
