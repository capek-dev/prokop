import type { SessionWirePorts } from '../ports/delivery';
import type { SessionExecutionPort } from '../ports/execution';
import type { ControllerGatePort } from '../ports/control';
import type { SessionRepositoryPort } from '../ports/session';
import { sendGateRejection } from './chat';

export interface SessionTranscriptDeps<Origin> {
  repository: SessionRepositoryPort;
  execution: SessionExecutionPort;
  gate: ControllerGatePort<Origin>;
}

export interface SessionTranscriptApplication<Origin> {
  compact(wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string): Promise<void>;
  revert(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    input: { sessionId: string; messageId: string },
  ): Promise<void>;
  fork(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    input: { sessionId: string; messageId: string; title?: string },
  ): Promise<void>;
  interrupt(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    input: { sessionId: string; reason?: string },
  ): Promise<void>;
}

export function createSessionTranscriptApplication<Origin>(
  deps: SessionTranscriptDeps<Origin>,
): SessionTranscriptApplication<Origin> {
  return {
    async compact(wire, _origin, sessionId): Promise<void> {
      const session = deps.repository.getSession(sessionId);
      if (!session) {
        wire.delivery.send(_origin, { type: 'error', code: 'not_found', message: 'Session not found', sessionId });
        return;
      }

      const execResult = await deps.execution.compact(sessionId, 'manual');

      if (execResult.ok) {
        wire.delivery.send(_origin, {
          type: 'compaction.complete',
          sessionId,
          tokensUsed: execResult.result.tokensUsed,
        });
      } else if (execResult.skipped) {
        wire.delivery.send(_origin, { type: 'error', code: 'invalid_session', message: execResult.error, sessionId });
      } else {
        wire.delivery.send(_origin, { type: 'error', code: 'compaction_error', message: execResult.error, sessionId });
      }
    },

    async revert(wire, origin, input): Promise<void> {
      const sessionId = input.sessionId;
      try {
        const session = deps.repository.getSession(sessionId);
        if (!session) {
          wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Session not found', sessionId });
          return;
        }

        const result = await deps.execution.revert({
          sessionId,
          targetMessageId: input.messageId,
        });

        wire.delivery.broadcastToSession(sessionId, {
          type: 'session.reverted',
          sessionId,
          revertedTo: result.revertedTo,
          removed: result.removed,
        });

        const currentState = deps.repository.listLatestMessagesWithPartsPage(sessionId, 50);
        wire.delivery.broadcastToSession(sessionId, {
          type: 'session.state',
          sessionId,
          messages: currentState.messages,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Revert failed';
        wire.delivery.send(origin, { type: 'error', code: 'revert_error', message, sessionId });
      }
    },

    async fork(wire, origin, input): Promise<void> {
      const sessionId = input.sessionId;
      try {
        const session = deps.repository.getSession(sessionId);
        if (!session) {
          wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Session not found', sessionId });
          return;
        }

        const result = await deps.execution.fork({
          sessionId,
          targetMessageId: input.messageId,
          title: input.title,
        });

        const forkedPage = deps.repository.listLatestMessagesWithPartsPage(result.forkedSession.id, 50);
        wire.delivery.broadcastToSession(sessionId, {
          type: 'session.forked',
          originalSessionId: sessionId,
          forkedSession: result.forkedSession,
          messages: forkedPage.messages,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Fork failed';
        wire.delivery.send(origin, { type: 'error', code: 'fork_error', message, sessionId });
      }
    },

    async interrupt(wire, origin, input): Promise<void> {
      const sessionId = input.sessionId;
      const session = deps.repository.getSession(sessionId);
      if (!session) {
        wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Session not found' });
        return;
      }
      const gate = deps.gate.checkControllerGate(sessionId, 'session.interrupt', origin);
      if (gate) {
        sendGateRejection(wire, origin, gate);
        return;
      }

      try {
        const result = await deps.execution.interruptSession(sessionId, input.reason || 'user_request');
        wire.delivery.broadcastToSession(sessionId, { type: 'session.interrupted', sessionId, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Interrupt failed';
        wire.delivery.send(origin, { type: 'error', code: 'interrupt_error', message });
      }
    },
  };
}
