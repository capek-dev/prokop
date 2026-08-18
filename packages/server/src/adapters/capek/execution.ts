import type { InterruptReason } from '@jean2/sdk';
import {
  executeCompaction as executeCapekCompaction,
  forkSession as forkCapekSession,
  handleChat as handleCapekChat,
  handleSessionEditMessage as handleCapekSessionEditMessage,
  interruptManager,
  regenerateSessionTitle as regenerateCapekSessionTitle,
  revertToStep as revertCapekToStep,
} from '@capekai/core/internal/execution';
import type {
  CompactionExecutionOutcome,
  ForkExecutionResult,
  InterruptExecutionResult,
  RevertExecutionResult,
  SessionExecutionPort,
} from '@/application/ports/execution';
import type { SessionWirePorts } from '@/application/ports/delivery';
import { createJean2RuntimeContext } from './events';
import { withJean2ExecutionScope } from './execution-scope';

export interface Jean2SessionExecutionDependencies {
  handleChat?: typeof handleCapekChat;
  handleSessionEditMessage?: typeof handleCapekSessionEditMessage;
  regenerateSessionTitle?: typeof regenerateCapekSessionTitle;
  executeCompaction?: typeof executeCapekCompaction;
  revertToStep?: typeof revertCapekToStep;
  forkSession?: typeof forkCapekSession;
}

function runtimeContext<Origin>(wire: SessionWirePorts<Origin>) {
  return createJean2RuntimeContext({
    send: wire.delivery.send,
    broadcast: wire.delivery.broadcast,
    broadcastToSession: wire.delivery.broadcastToSession,
    sendToController: wire.delivery.sendToController,
    sendToAskTargets: wire.delivery.sendToAskTargets,
    attachOriginToSession: wire.actor.attachOriginToSession,
  });
}

/**
 * Capek execution adapter (S3).
 *
 * Fulfills the application execution port with the exact current Capek
 * execution identities. Every stateful execution entry enters the composed
 * Jean2 agent scope for its full awaited duration. Interrupt methods remain
 * direct because interruptManager has no AsyncLocalStorage state.
 */
export function createJean2SessionExecution(
  dependencies: Jean2SessionExecutionDependencies = {},
): SessionExecutionPort {
  const handleChat = dependencies.handleChat ?? handleCapekChat;
  const handleSessionEditMessage = dependencies.handleSessionEditMessage ?? handleCapekSessionEditMessage;
  const regenerateSessionTitle = dependencies.regenerateSessionTitle ?? regenerateCapekSessionTitle;
  const executeCompaction = dependencies.executeCompaction ?? executeCapekCompaction;
  const revertToStep = dependencies.revertToStep ?? revertCapekToStep;
  const forkSession = dependencies.forkSession ?? forkCapekSession;

  return {
    sendMessage<Origin>(
      wire: SessionWirePorts<Origin>,
      origin: Origin,
      sessionId: string,
      content: string,
      attachments?: Array<{ id: string; kind: string }>,
      responseFormatId?: string,
      goalCondition?: string,
      goalMaxTurns?: number,
    ): Promise<void> {
      return withJean2ExecutionScope(() => handleChat(
        runtimeContext(wire),
        origin,
        sessionId,
        content,
        attachments,
        responseFormatId,
        goalCondition,
        goalMaxTurns,
      ));
    },

    editMessage<Origin>(
      wire: SessionWirePorts<Origin>,
      origin: Origin,
      input: { sessionId: string; messageId: string; content: string },
    ): Promise<void> {
      return withJean2ExecutionScope(() => handleSessionEditMessage(
        runtimeContext(wire),
        origin,
        input,
      ));
    },

    regenerateTitle<Origin>(
      wire: SessionWirePorts<Origin>,
      origin: Origin,
      sessionId: string,
      options?: { force?: boolean },
    ): Promise<void> {
      return withJean2ExecutionScope(() => regenerateSessionTitle(
        runtimeContext(wire),
        origin,
        sessionId,
        options,
      ));
    },

    async interruptSession(sessionId: string, reason?: string): Promise<InterruptExecutionResult> {
      return interruptManager.interruptSession(sessionId, (reason ?? 'user_request') as InterruptReason);
    },

    isSessionActive(sessionId: string): boolean {
      return interruptManager.isSessionActive(sessionId);
    },

    async compact(sessionId: string, reason: 'manual'): Promise<CompactionExecutionOutcome> {
      const result = await withJean2ExecutionScope(() => executeCompaction(sessionId, reason));
      return result as CompactionExecutionOutcome;
    },

    async revert(input: { sessionId: string; targetMessageId: string }): Promise<RevertExecutionResult> {
      const result = await withJean2ExecutionScope(() => revertToStep(input));
      return result as RevertExecutionResult;
    },

    async fork(input: { sessionId: string; targetMessageId: string; title?: string }): Promise<ForkExecutionResult> {
      const result = await withJean2ExecutionScope(() => forkSession(input));
      return result as unknown as ForkExecutionResult;
    },
  };
}
