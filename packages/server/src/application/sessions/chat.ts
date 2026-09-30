import type { ServerMessage } from '@prokopai/sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';
import type { SessionExecutionPort } from '@/application/ports/execution';
import type { ControllerGatePort, ControllerGateRejection } from '@/application/ports/control';
import type { SessionRepositoryPort } from '@/application/ports/session';

export interface SessionChatDeps<Origin> {
  repository: SessionRepositoryPort;
  execution: SessionExecutionPort;
  gate: ControllerGatePort<Origin>;
}

export interface SessionChatApplication<Origin> {
  sendMessage(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    sessionId: string,
    content: string,
    attachments?: Array<{ id: string; kind: string }>,
    responseFormatId?: string,
    goalCondition?: string,
    goalMaxTurns?: number,
    goalTokenBudget?: number,
  ): Promise<void>;
  editMessage(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    input: { sessionId: string; messageId: string; content: string },
  ): Promise<void>;
  generateTitle(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    sessionId: string,
    force: boolean,
  ): void;
}

export function sendGateRejection<Origin>(
  wire: SessionWirePorts<Origin>,
  origin: Origin,
  rejection: ControllerGateRejection,
): void {
  const message: ServerMessage = {
    type: 'session.action_rejected',
    sessionId: rejection.sessionId,
    action: rejection.action,
    code: rejection.code,
    message: rejection.message,
    control: rejection.control,
  };
  wire.delivery.send(origin, message);
}

export function createSessionChatApplication<Origin>(deps: SessionChatDeps<Origin>): SessionChatApplication<Origin> {
  // Capek fires its own auto-title for Prokop sessions right after
  // persisting the user message inside handleChat; external harnesses have
  // no such hook, so the universal server-side regeneration runs fire and
  // forget once the awaited turn settles. Legacy rows without a harness
  // field are Prokop sessions and stay on the Capek path.
  const autoTitleForExternalHarness = (wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string): void => {
    const session = deps.repository.getSession(sessionId);
    if (!session || session.harness === undefined || session.harness === 'prokop') return;
    void deps.execution.regenerateTitle(wire, origin, sessionId);
  };

  return {
    async sendMessage(
      wire,
      origin,
      sessionId,
      content,
      attachments,
      responseFormatId,
      goalCondition,
      goalMaxTurns,
      goalTokenBudget,
    ): Promise<void> {
      const gate = deps.gate.checkControllerGate(sessionId, 'chat.message', origin);
      if (gate) {
        sendGateRejection(wire, origin, gate);
        return;
      }
      await deps.execution.sendMessage(
        wire,
        origin,
        sessionId,
        content,
        attachments,
        responseFormatId,
        goalCondition,
        goalMaxTurns,
        goalTokenBudget,
      );
      autoTitleForExternalHarness(wire, origin, sessionId);
    },

    async editMessage(wire, origin, input): Promise<void> {
      const gate = deps.gate.checkControllerGate(input.sessionId, 'chat.message', origin);
      if (gate) {
        sendGateRejection(wire, origin, gate);
        return;
      }
      await deps.execution.editMessage(wire, origin, input);
      autoTitleForExternalHarness(wire, origin, input.sessionId);
    },

    generateTitle(wire, origin, sessionId, force): void {
      const session = deps.repository.getSession(sessionId);
      if (!session) {
        wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Session not found', sessionId });
        return;
      }
      void deps.execution.regenerateTitle(wire, origin, sessionId, { force });
    },
  };
}
