import type { SessionWirePorts } from '../ports/delivery';
import type { SessionExecutionPort } from '../ports/execution';
import type { ControllerGatePort } from '../ports/control';
import type { SessionRepositoryPort } from '../ports/session';
import type { ToolCatalogPort } from '../ports/tool-catalog';
import type { WorktreeAttachmentRefreshPort } from '../ports/worktree';
import { sendGateRejection } from './chat';
import { projectMessagesForClient } from './tool-debug';

export interface SessionTranscriptDeps<Origin> {
  repository: SessionRepositoryPort;
  execution: SessionExecutionPort;
  gate: ControllerGatePort<Origin>;
  toolCatalog?: Pick<ToolCatalogPort, 'listTools'>;
  worktreeAttachments?: WorktreeAttachmentRefreshPort;
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
    async compact(wire, origin, sessionId): Promise<void> {
      const session = deps.repository.getSession(sessionId);
      if (!session) {
        wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Session not found', sessionId });
        return;
      }

      const gate = deps.gate.checkControllerGate(sessionId, 'session.compact', origin);
      if (gate) {
        sendGateRejection(wire, origin, gate);
        return;
      }

      const execResult = await deps.execution.compact(sessionId, 'manual');

      if (execResult.ok) {
        wire.delivery.send(origin, {
          type: 'compaction.complete',
          sessionId,
          tokensUsed: execResult.result.tokensUsed,
        });
      } else if (execResult.skipped) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: execResult.error, sessionId });
      } else {
        wire.delivery.send(origin, { type: 'error', code: 'compaction_error', message: execResult.error, sessionId });
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

        const gate = deps.gate.checkControllerGate(sessionId, 'session.revert', origin);
        if (gate) {
          sendGateRejection(wire, origin, gate);
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
        const clientMessages = await projectMessagesForClient(currentState.messages, deps.toolCatalog);
        wire.delivery.broadcastToSession(sessionId, {
          type: 'session.state',
          sessionId,
          messages: clientMessages,
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

        const gate = deps.gate.checkControllerGate(sessionId, 'session.fork', origin);
        if (gate) {
          sendGateRejection(wire, origin, gate);
          return;
        }

        const result = await deps.execution.fork({
          sessionId,
          targetMessageId: input.messageId,
          title: input.title,
        });
        // Capek's fork cannot carry Prokop's workspaceRootId extension, so
        // inherit the source binding here and broadcast the patched record.
        let forkedSession = result.forkedSession;
        if (session.workspaceRootId && !forkedSession.workspaceRootId) {
          const patched = deps.repository.updateSession(forkedSession.id, {
            workspaceRootId: session.workspaceRootId,
          });
          if (patched) forkedSession = patched;
        }
        if (forkedSession.workspaceRootId) {
          deps.worktreeAttachments?.changed(forkedSession.workspaceRootId);
        }

        const forkedPage = deps.repository.listLatestMessagesWithPartsPage(result.forkedSession.id, 50);
        const clientMessages = await projectMessagesForClient(forkedPage.messages, deps.toolCatalog);
        wire.delivery.broadcastToSession(sessionId, {
          type: 'session.forked',
          originalSessionId: sessionId,
          forkedSession,
          messages: clientMessages,
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
        if (session.workspaceRootId) {
          deps.worktreeAttachments?.changed(session.workspaceRootId);
        }
        wire.delivery.broadcastToSession(sessionId, { type: 'session.interrupted', sessionId, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Interrupt failed';
        wire.delivery.send(origin, { type: 'error', code: 'interrupt_error', message });
      }
    },
  };
}
