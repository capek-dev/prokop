/**
 * S5 compat forwarder. Message and part SQL and row mapping moved to
 * `infrastructure/sqlite/message-repository.ts`; this module keeps every
 * pre-slice export identity and owns the temporary FTS sync helper (which
 * reads message/session content and calls the FTS index), preserving the
 * exact pre-slice ordering around CRUD. S6 owns moving the projection
 * behind committed events, at which point the FTS hooks retire.
 */

import { getDatabase } from './index';
import { getSession } from './sessions';
import { createFtsProjector } from '@/infrastructure/session-search/fts-projector';
import type { Message, MessageWithParts, Part, ToolPart } from '@jean2/sdk';
import {
  createMessageRepository,
  type MessageDatabaseAccessor,
} from '@/infrastructure/sqlite/message-repository';
import type {
  CompactionBoundary,
  MessageStorePort,
  SessionMessageRepositoryHooks,
  StreamingPartSnapshot,
  ToolInterruptReason,
  TranscriptPageResult,
} from '@/application/ports/session-message';

export type {
  StreamingPartSnapshot,
  ToolInterruptReason,
  TranscriptPageResult,
} from '@/application/ports/session-message';

function buildHooks(): SessionMessageRepositoryHooks {
  return {
    events: createFtsProjector({
      getMessage: (messageId) => repo().getMessage(messageId),
      getSession,
    }),
    deleteAttachmentsForSession: () => {},
    deleteAttachmentsForWorkspace: () => {},
    cleanupSessionOutputDir: () => {},
  };
}

let repository: MessageStorePort | null = null;

/** Lazily created compat repository over the current store database
 * accessor, exactly like the other S5 compat modules. */
function repo(): MessageStorePort {
  return (repository ??= createMessageRepository(
    getDatabase as MessageDatabaseAccessor,
    buildHooks(),
  ));
}

export function createMessage(message: Message): Message {
  return repo().createMessage(message);
}

export function getMessage(id: string): Message | null {
  return repo().getMessage(id);
}

export function updateMessage(
  id: string,
  updates: Partial<Message>,
  options?: { syncFts?: boolean },
): Message | null {
  return repo().updateMessage(id, updates, options);
}

export function listMessages(sessionId: string): Message[] {
  return repo().listMessages(sessionId);
}

export function deleteMessages(sessionId: string): number {
  return repo().deleteMessages(sessionId);
}

export function deleteMessage(messageId: string): boolean {
  return repo().deleteMessage(messageId);
}

export function createPart(
  part: Part,
  sessionId: string,
  options?: { syncFts?: boolean },
): Part {
  return repo().createPart(part, sessionId, options);
}

export function getPart(id: string): Part | null {
  return repo().getPart(id);
}

export function updatePart(
  id: string,
  updates: Record<string, unknown>,
  options?: { syncFts?: boolean },
): Part | null {
  return repo().updatePart(id, updates, options);
}

export function getPartsByMessage(messageId: string): Part[] {
  return repo().getPartsByMessage(messageId);
}

export function getPartsBySession(sessionId: string): Part[] {
  return repo().getPartsBySession(sessionId);
}

export function getMessageWithParts(messageId: string): MessageWithParts | null {
  return repo().getMessageWithParts(messageId);
}

export function listMessagesWithParts(sessionId: string): MessageWithParts[] {
  return repo().listMessagesWithParts(sessionId);
}

export function createToolPartPending(
  messageId: string,
  callId: string,
  toolName: string,
  input: Record<string, unknown>,
  sessionId: string,
): ToolPart {
  return repo().createToolPartPending(messageId, callId, toolName, input, sessionId);
}

export function transitionToolToRunning(
  partId: string,
  childSessionId?: string,
): ToolPart | null {
  return repo().transitionToolToRunning(partId, childSessionId);
}

export function transitionToolToCompleted(
  partId: string,
  output: unknown,
): ToolPart | null {
  return repo().transitionToolToCompleted(partId, output);
}

export function transitionToolToError(partId: string, error: string): ToolPart | null {
  return repo().transitionToolToError(partId, error);
}

export function getToolPartByCallId(
  sessionId: string,
  callId: string,
): ToolPart | null {
  return repo().getToolPartByCallId(sessionId, callId);
}

export function transitionToolToRunningByCallId(
  sessionId: string,
  callId: string,
  childSessionId?: string,
): ToolPart | null {
  return repo().transitionToolToRunningByCallId(sessionId, callId, childSessionId);
}

export function transitionToolToInterrupted(
  partId: string,
  reason: ToolInterruptReason,
): ToolPart | null {
  return repo().transitionToolToInterrupted(partId, reason);
}

export function findOrphanedToolCalls(sessionId: string): ToolPart[] {
  return repo().findOrphanedToolCalls(sessionId);
}

export function reconcileOrphanedToolCalls(sessionId: string): number {
  return repo().reconcileOrphanedToolCalls(sessionId);
}

export function reconcileAllOrphanedToolCalls(): number {
  return repo().reconcileAllOrphanedToolCalls();
}

export function findOrphanedCompactionTriggers(sessionId: string): Message[] {
  return repo().findOrphanedCompactionTriggers(sessionId);
}

export function listMessagesForSession(sessionId: string): MessageWithParts[] {
  return repo().listMessagesForSession(sessionId);
}

export function getLatestCompactionBoundary(
  sessionId: string,
): CompactionBoundary | null {
  return repo().getLatestCompactionBoundary(sessionId);
}

export function listMessagesWithPartsFromSequence(
  sessionId: string,
  sequence: number,
): MessageWithParts[] {
  return repo().listMessagesWithPartsFromSequence(sessionId, sequence);
}

export function buildEffectiveContextHistory(
  sessionId: string,
): {
  messages: MessageWithParts[];
  latestCompactionBoundary: string | null;
  hasCompaction: boolean;
} {
  return repo().buildEffectiveContextHistory(sessionId);
}

export function countMessagesInSession(sessionId: string): number {
  return repo().countMessagesInSession(sessionId);
}

export function listLatestMessagesWithPartsPage(
  sessionId: string,
  limit?: number,
): TranscriptPageResult {
  return repo().listLatestMessagesWithPartsPage(sessionId, limit);
}

export function listMessagesWithPartsBeforeSequence(
  sessionId: string,
  beforeSequence: number,
  limit?: number,
): TranscriptPageResult {
  return repo().listMessagesWithPartsBeforeSequence(sessionId, beforeSequence, limit);
}

export function syncMessageFts(messageId: string): void {
  repo().syncMessageFts(messageId);
}

export function persistStreamingPartSnapshot(snapshot: StreamingPartSnapshot): boolean {
  return repo().persistStreamingPartSnapshot(snapshot);
}

export function persistStreamingPartSnapshots(snapshots: StreamingPartSnapshot[]): number {
  return repo().persistStreamingPartSnapshots(snapshots);
}
