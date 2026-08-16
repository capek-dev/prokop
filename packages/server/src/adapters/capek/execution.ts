import type { InterruptReason } from '@jean2/sdk';
import {
  executeCompaction as executeCapekCompaction,
  forkSession as forkCapekSession,
  handleChat as handleCapekChat,
  handleSessionEditMessage as handleCapekSessionEditMessage,
  interruptManager,
  regenerateSessionTitle as regenerateCapekSessionTitle,
  revertToStep as revertCapekToStep,
} from '@capekai/core/compat/jean2';
import type {
  CompactionExecutionOutcome,
  ForkExecutionResult,
  InterruptExecutionResult,
  RevertExecutionResult,
  SessionExecutionPort,
} from '@/application/ports/execution';
import type { SessionWirePorts } from '@/application/ports/delivery';
import { createJean2RuntimeContext } from './events';

/**
 * Capek execution adapter (S3).
 *
 * Fulfills the application execution port with the exact current Capek
 * compat identities. Send and edit delegate to the same handleChat and
 * handleSessionEditMessage identities and await the same completion; no
 * algorithm is duplicated here. The Capek runtime context is constructed
 * from the application wire ports, exactly like the pre-S3 chat handler.
 */
export function createJean2SessionExecution(): SessionExecutionPort {
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
      return handleCapekChat(
        createJean2RuntimeContext({
          send: wire.delivery.send,
          broadcast: wire.delivery.broadcast,
          broadcastToSession: wire.delivery.broadcastToSession,
          sendToController: wire.delivery.sendToController,
          sendToAskTargets: wire.delivery.sendToAskTargets,
          attachOriginToSession: wire.actor.attachOriginToSession,
        }),
        origin,
        sessionId,
        content,
        attachments,
        responseFormatId,
        goalCondition,
        goalMaxTurns,
      );
    },

    editMessage<Origin>(
      wire: SessionWirePorts<Origin>,
      origin: Origin,
      input: { sessionId: string; messageId: string; content: string },
    ): Promise<void> {
      return handleCapekSessionEditMessage(
        createJean2RuntimeContext({
          send: wire.delivery.send,
          broadcast: wire.delivery.broadcast,
          broadcastToSession: wire.delivery.broadcastToSession,
          sendToController: wire.delivery.sendToController,
          sendToAskTargets: wire.delivery.sendToAskTargets,
          attachOriginToSession: wire.actor.attachOriginToSession,
        }),
        origin,
        input,
      );
    },

    regenerateTitle<Origin>(
      wire: SessionWirePorts<Origin>,
      origin: Origin,
      sessionId: string,
      options?: { force?: boolean },
    ): Promise<void> {
      return regenerateCapekSessionTitle(
        createJean2RuntimeContext({
          send: wire.delivery.send,
          broadcast: wire.delivery.broadcast,
          broadcastToSession: wire.delivery.broadcastToSession,
          sendToController: wire.delivery.sendToController,
          sendToAskTargets: wire.delivery.sendToAskTargets,
          attachOriginToSession: wire.actor.attachOriginToSession,
        }),
        origin,
        sessionId,
        options,
      );
    },

    async interruptSession(sessionId: string, reason?: string): Promise<InterruptExecutionResult> {
      return interruptManager.interruptSession(sessionId, (reason ?? 'user_request') as InterruptReason);
    },

    isSessionActive(sessionId: string): boolean {
      return interruptManager.isSessionActive(sessionId);
    },

    async compact(sessionId: string, reason: 'manual'): Promise<CompactionExecutionOutcome> {
      const result = await executeCapekCompaction(sessionId, reason);
      return result as CompactionExecutionOutcome;
    },

    async revert(input: { sessionId: string; targetMessageId: string }): Promise<RevertExecutionResult> {
      const result = await revertCapekToStep(input);
      return result as RevertExecutionResult;
    },

    async fork(input: { sessionId: string; targetMessageId: string; title?: string }): Promise<ForkExecutionResult> {
      const result = await forkCapekSession(input);
      return result as unknown as ForkExecutionResult;
    },
  };
}
