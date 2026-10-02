/**
 * Message and part persistence with the FTS projection hooks that must stay
 * ordered with CRUD. The repository is created lazily over the database
 * singleton, preserving test database replacement and existing call timing.
 */

import { getDatabase } from './database';
import { notifyWorkspaceActivity } from '@/application/workspaces/activity';
import { notifyWorkspaceFilesChanged } from '@/application/workspaces/files-changed';
import { getWorkspaceLastConversationAt } from './workspaces';
import { notifyLearningActivity } from '@/application/learning/activity';
import { getSession } from './session-store';
import { createFtsProjector } from '@/infrastructure/session-search/fts-projector';
import { isFileMutatingToolName } from '@prokopai/sdk';
import type { Message, MessageWithParts, Part, ToolPart } from '@prokopai/sdk';
import {
  createMessageRepository,
  type MessageDatabaseAccessor,
} from './message-repository';
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
      getDatabase,
      getMessage: (messageId) => repo().getMessage(messageId),
      getSession,
    }),
    deleteAttachmentsForSession: () => {},
    deleteAttachmentsForWorkspace: () => {},
    cleanupSessionOutputDir: () => {},
  };
}

let repository: MessageStorePort | null = null;

function repo(): MessageStorePort {
  return (repository ??= createMessageRepository(
    getDatabase as MessageDatabaseAccessor,
    buildHooks(),
  ));
}

function publishConversationActivity(sessionId: string): void {
  const workspaceId = getSession(sessionId)?.workspaceId;
  if (workspaceId) notifyWorkspaceActivity(workspaceId, getWorkspaceLastConversationAt(workspaceId));
}

const TERMINAL_TOOL_STATUSES = new Set(['completed', 'error', 'interrupted']);

/**
 * Emits the workspace files-changed notification when a tool part whose
 * completion may write files reaches a terminal status. `previous` guards
 * against re-firing when a terminal state is re-persisted; the transition
 * wrappers pass null because the repository already gates them on a running
 * part.
 */
function notifyFilesChangedFromToolPart(previous: Part | null, updated: Part | null): void {
  if (!updated || updated.type !== 'tool') return;
  const toolPart = updated as ToolPart;
  if (!isFileMutatingToolName(toolPart.name)) return;
  if (previous?.type === 'tool'
    && TERMINAL_TOOL_STATUSES.has((previous as ToolPart).state.status)) return;
  const sessionId = repo().getSessionIdByPartId(toolPart.id);
  if (!sessionId) return;
  const workspaceId = getSession(sessionId)?.workspaceId;
  if (workspaceId) notifyWorkspaceFilesChanged(workspaceId);
}

export function createMessage(message: Message): Message {
  const result = repo().createMessage(message);
  if (message.role === 'user' || message.role === 'assistant') publishConversationActivity(message.sessionId);
  notifyLearningActivity();
  return result;
}

export function getMessage(id: string): Message | null {
  return repo().getMessage(id);
}

export function updateMessage(
  id: string,
  updates: Partial<Message>,
  options?: { syncFts?: boolean },
): Message | null {
  const result = repo().updateMessage(id, updates, options);
  if ('status' in updates) notifyLearningActivity();
  return result;
}

export function listMessages(sessionId: string): Message[] {
  return repo().listMessages(sessionId);
}

export function deleteMessages(sessionId: string): number {
  const result = repo().deleteMessages(sessionId);
  if (result > 0) {
    notifyLearningActivity();
    publishConversationActivity(sessionId);
  }
  return result;
}

export function deleteMessage(messageId: string): boolean {
  const message = repo().getMessage(messageId);
  const result = repo().deleteMessage(messageId);
  if (result) {
    notifyLearningActivity();
    if (message) publishConversationActivity(message.sessionId);
  }
  return result;
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
  // The capek runtime persists tool transitions as updatePart(id, { state }).
  // Streaming text updates never carry state, so the pre-read below costs
  // nothing on the hot path.
  const state = updates.state;
  const status = state !== null && typeof state === 'object'
    && typeof (state as { status?: unknown }).status === 'string'
      ? (state as { status: string }).status
      : null;
  const isTerminalTransition = status !== null && TERMINAL_TOOL_STATUSES.has(status);
  const previous = isTerminalTransition ? repo().getPart(id) : null;
  const result = repo().updatePart(id, updates, options);
  if (isTerminalTransition) notifyFilesChangedFromToolPart(previous, result);
  return result;
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
  const result = repo().transitionToolToCompleted(partId, output);
  notifyFilesChangedFromToolPart(null, result);
  return result;
}

export function transitionToolToError(partId: string, error: string): ToolPart | null {
  const result = repo().transitionToolToError(partId, error);
  notifyFilesChangedFromToolPart(null, result);
  return result;
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
  const result = repo().transitionToolToInterrupted(partId, reason);
  notifyFilesChangedFromToolPart(null, result);
  return result;
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
