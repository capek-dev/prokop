import type { SessionWirePorts } from '@/application/ports/delivery';
import type { ControllerGatePort } from '@/application/ports/control';
import type { SessionRepositoryPort } from '@/application/ports/session';
import type { SessionExecutionPort } from '@/application/ports/execution';
import { sendGateRejection } from './chat';
import { unknownHarnessError } from './harness-policy';

export interface SessionQueueDeps<Origin> {
  repository: SessionRepositoryPort;
  gate: ControllerGatePort<Origin>;
  execution?: Pick<SessionExecutionPort, 'drainQueue'>;
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
      const featureError = unknownHarnessError(session.harness);
      if (featureError) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: featureError, sessionId });
        return;
      }
      const gate = deps.gate.checkControllerGate(sessionId, 'queue.add', origin);
      if (gate) {
        sendGateRejection(wire, origin, gate);
        return;
      }

      const cli = session.harness === 'codex-cli' || session.harness === 'claude-cli';
      if (cli && (session.parentId || session.status !== 'active' || session.compacting)) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: 'Session cannot accept queued messages', sessionId });
        return;
      }
      if (cli && input.attachments?.length) {
        const records = deps.repository.attachments.listForSession(sessionId);
        if (session.harness === 'claude-cli' && input.attachments.length > 10 || input.attachments.some(attachment =>
          attachment.kind !== 'image' || !records.some(record => record.id === attachment.id
            && record.kind === 'image' && record.workspaceId === session.workspaceId
            && deps.repository.attachments.validateImageMime(record.mimeType)))) {
          wire.delivery.send(origin, { type: 'error', code: 'invalid_content', message: 'CLI queues support session image attachments only', sessionId });
          return;
        }
      }
      if (!input.content?.trim() && !(cli && input.attachments?.length)) {
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
      // A client's running state may lag behind turn completion. Wake idle queues too.
      if (cli) void deps.execution?.drainQueue?.(wire, origin, sessionId).catch(() => {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', sessionId,
          message: 'Queued message could not be sent' });
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
