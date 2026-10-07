import type { Session } from '@prokopai/sdk/types/session';
import type { InterruptReason } from '@prokopai/sdk';
import { executeCompaction as executeCapekCompaction } from '@/harnesses/prokop/compaction/executor';
import { forkSession as forkCapekSession } from '@/harnesses/prokop/execution/fork';
import {
  handleChat as handleCapekChat,
  handleSessionEditMessage as handleCapekSessionEditMessage,
  regenerateSessionTitle as regenerateCapekSessionTitle,
} from '@/harnesses/prokop/execution/chat-handler';
import { interruptManager } from '@/harnesses/prokop/execution/interrupt';
import { revertToStep as revertCapekToStep } from '@/harnesses/prokop/execution/revert';
import { executeChildSession as capekExecuteChildSession } from '@/harnesses/prokop/subagent/child-session';
import type {
  CompactionExecutionOutcome,
  ForkExecutionResult,
  InterruptExecutionResult,
  RevertExecutionResult,
  SessionExecutionPort,
} from '@/application/ports/execution';
import type {
  HeadlessSessionRunInput,
  HeadlessSessionRunResult,
} from '@/application/ports/headless-execution';
import type { SessionWirePorts } from '@/application/ports/delivery';
import { createProkopRuntimeContext } from '@/harnesses/prokop/host/events';
import { withProkopComposedScopeSync, withProkopExecutionScope } from '@/harnesses/prokop/composition/execution-scope';

export interface ProkopSessionExecutionDependencies {
  handleChat?: typeof handleCapekChat;
  handleSessionEditMessage?: typeof handleCapekSessionEditMessage;
  regenerateSessionTitle?: typeof regenerateCapekSessionTitle;
  executeCompaction?: typeof executeCapekCompaction;
  revertToStep?: typeof revertCapekToStep;
  forkSession?: typeof forkCapekSession;
  executeChildSession?: typeof capekExecuteChildSession;
  onSessionChanged?: (session: Session) => void;
}

function runtimeContext<Origin>(
  wire: SessionWirePorts<Origin>,
  onSessionChanged?: (session: Session) => void,
) {
  return createProkopRuntimeContext({
    send: wire.delivery.send,
    broadcast: wire.delivery.broadcast,
    broadcastToSession: wire.delivery.broadcastToSession,
    sendToController: wire.delivery.sendToController,
    sendToAskTargets: wire.delivery.sendToAskTargets,
    attachOriginToSession: wire.actor.attachOriginToSession,
  }, onSessionChanged);
}

/**
 * Capek execution adapter (S3).
 *
 * Fulfills the application execution port with the exact current Capek
 * execution identities. Every stateful execution entry enters the composed
 * Jean2 agent scope for its full awaited duration. Wire-side interruption
 * enters the same composed scope to settle pending asks.
 */
export function createProkopSessionExecution(
  dependencies: ProkopSessionExecutionDependencies = {},
): SessionExecutionPort {
  const handleChat = dependencies.handleChat ?? handleCapekChat;
  const handleSessionEditMessage = dependencies.handleSessionEditMessage ?? handleCapekSessionEditMessage;
  const regenerateSessionTitle = dependencies.regenerateSessionTitle ?? regenerateCapekSessionTitle;
  const executeCompaction = dependencies.executeCompaction ?? executeCapekCompaction;
  const revertToStep = dependencies.revertToStep ?? revertCapekToStep;
  const forkSession = dependencies.forkSession ?? forkCapekSession;
  const onSessionChanged = dependencies.onSessionChanged;

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
      return withProkopExecutionScope(() => handleChat(
        runtimeContext(wire, onSessionChanged),
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
      return withProkopExecutionScope(() => handleSessionEditMessage(
        runtimeContext(wire, onSessionChanged),
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
      return withProkopExecutionScope(() => regenerateSessionTitle(
        runtimeContext(wire, onSessionChanged),
        origin,
        sessionId,
        options,
      ));
    },

    async interruptSession(sessionId: string, reason?: string): Promise<InterruptExecutionResult> {
      // Wire-side interrupt arrives outside any execution context, but the
      // interrupt path rejects pending asks, and the live ask waiters live in
      // the composed permission runtime that execution entered. Running the
      // interrupt unscoped hit the process-default runtime's empty waiter
      // map: the question tool's ctx.ask() never settled and the session
      // stayed registered (bricked in "running"). Route through the composed
      // scope exactly like the other wire-side ask seams.
      return withProkopComposedScopeSync(() =>
        interruptManager.interruptSession(sessionId, (reason ?? 'user_request') as InterruptReason));
    },

    isSessionActive(sessionId: string): boolean {
      return interruptManager.isSessionActive(sessionId);
    },

    async compact(sessionId: string, reason: 'manual'): Promise<CompactionExecutionOutcome> {
      const result = await withProkopExecutionScope(() => executeCompaction(sessionId, reason));
      return result as CompactionExecutionOutcome;
    },

    async revert(input: { sessionId: string; targetMessageId: string }): Promise<RevertExecutionResult> {
      const result = await withProkopExecutionScope(() => revertToStep(input));
      return result as RevertExecutionResult;
    },

    async fork(input: { sessionId: string; targetMessageId: string; title?: string }): Promise<ForkExecutionResult> {
      const result = await withProkopExecutionScope(() => forkSession(input));
      return result as unknown as ForkExecutionResult;
    },
  };
}

/**
 * Headless child-run execution for scheduled jobs (S11.3 slice 3). Enters
 * the composed Jean2 agent scope for the full awaited run exactly like the
 * session execution entries; the scheduled runner resolves session
 * identity and model selection and never reaches harness internals. The
 * harness field is dispatch metadata and is dropped before the Capek call.
 */
export function createProkopHeadlessExecution(
  dependencies: Pick<ProkopSessionExecutionDependencies, 'executeChildSession'> = {},
): (input: HeadlessSessionRunInput) => Promise<HeadlessSessionRunResult> {
  const executeChildSession = dependencies.executeChildSession ?? capekExecuteChildSession;
  return input => withProkopExecutionScope(() => {
    const { harness: _harness, ...child } = input;
    return executeChildSession(child);
  });
}
