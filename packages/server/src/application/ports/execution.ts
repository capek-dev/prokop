import type { Session } from '@prokopai/sdk';
import type { SessionWirePorts } from './delivery';

/**
 * Compact / revert / fork result contracts, structural copies of the Capek
 * execution results. The Capek execution adapter maps those results onto these
 * contracts; no algorithm lives in the application layer.
 */
export interface CompactionExecutionResult {
  ok: true;
  result: { tokensUsed: { prompt: number; completion: number } };
}
export interface CompactionExecutionError {
  ok: false;
  error: string;
  skipped?: boolean;
}
export type CompactionExecutionOutcome = CompactionExecutionResult | CompactionExecutionError;

export interface RevertExecutionResult {
  revertedTo: { messageId: string | null; messageCount: number };
  removed: { messageIds: string[]; partCount: number };
}

export interface ForkExecutionResult {
  forkedSession: Session;
  messages: unknown[];
}

export interface InterruptExecutionResult {
  sessionId: string;
  success: boolean;
  cascadedTo: string[];
  interruptedTools: string[];
  rejectedAsks: string[];
}

export interface EditMessageInput {
  sessionId: string;
  messageId: string;
  content: string;
}

/**
 * Execution port. Each operation delegates to the exact current internal Capek
 * execution identity (handleChat, handleSessionEditMessage,
 * regenerateSessionTitle, interruptManager, executeCompaction, revertToStep,
 * forkSession) and awaits the same completion. The adapter owns the Capek
 * runtime-context construction; the application only supplies delivery and
 * origin bookkeeping through the wire ports.
 */
export interface SessionExecutionPort {
  sendMessage<Origin>(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    sessionId: string,
    content: string,
    attachments?: Array<{ id: string; kind: string }>,
    responseFormatId?: string,
    goalCondition?: string,
    goalMaxTurns?: number,
  ): Promise<void>;
  editMessage<Origin>(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    input: EditMessageInput,
  ): Promise<void>;
  regenerateTitle<Origin>(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    sessionId: string,
    options?: { force?: boolean },
  ): Promise<void>;
  interruptSession(sessionId: string, reason?: string): Promise<InterruptExecutionResult>;
  isSessionActive(sessionId: string): boolean;
  compact(sessionId: string, reason: 'manual'): Promise<CompactionExecutionOutcome>;
  revert(input: { sessionId: string; targetMessageId: string }): Promise<RevertExecutionResult>;
  fork(input: { sessionId: string; targetMessageId: string; title?: string }): Promise<ForkExecutionResult>;
}
