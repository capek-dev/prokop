/**
 * Inward-facing session/message/part repository ports (S5, session and
 * message repository isolation). Structural contracts over SDK types only;
 * no SQL crosses the boundary. The infrastructure repositories under
 * `infrastructure/sqlite` implement these ports over an injected database
 * accessor. The temporary hooks carry the side effects the current
 * implementation interleaves with SQL (FTS projection calls, attachment
 * deletion, output-dir cleanup); S6 owns moving the projection behind
 * committed events, at which point the FTS hooks retire.
 */

import type { SessionMessageEventPublisher } from './session-message-events';
import type {
  Message,
  MessageWithParts,
  Part,
  Session,
  SessionStatus,
  SubagentStatus,
  ToolPart,
  UserMessage,
  SystemMessage,
  AssistantMessage,
} from '@prokopai/sdk';

export interface SessionMessageRepositoryHooks {
  events: SessionMessageEventPublisher;
  /** Attachment store seam used by the session delete transaction. */
  deleteAttachmentsForSession(sessionId: string): void;
  deleteAttachmentsForWorkspace(workspaceId: string): void;
  /** Output-directory cleanup used by session delete. */
  cleanupSessionOutputDir(sessionId: string): void;
}

export interface SessionCursorPayload {
  version: 1;
  updatedAt: string;
  id: string;
}

export interface SessionPageInfo {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

export interface SessionPage {
  sessions: Session[];
  nextCursor: SessionCursorPayload | null;
  hasMore: boolean;
}

export interface ListSessionPageOptions {
  status?: SessionStatus;
  rootOnly?: boolean;
  cursor?: SessionCursorPayload;
  limit: number;
}

export type SessionCreateInput = Omit<Session, 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
};

export type SessionUpdateInput = Partial<
  Pick<
    Session,
    | 'title'
    | 'status'
    | 'metadata'
    | 'preconfigId'
    | 'selectedModel'
    | 'selectedProvider'
    | 'selectedVariant'
    | 'promptTokens'
    | 'completionTokens'
    | 'totalTokens'
    | 'cacheReadTokens'
    | 'cacheWriteTokens'
    | 'noCacheTokens'
    | 'parentId'
    | 'agentName'
    | 'subagentStatus'
    | 'runningAt'
    | 'compacting'
    | 'tags'
    | 'autoApproveSeverity'
    | 'agentId'
  >
>;

export interface SessionStorePort {
  createSession(session: SessionCreateInput): Session;
  getSession(id: string): Session | null;
  listSessions(status?: SessionStatus): Session[];
  updateSession(id: string, updates: SessionUpdateInput): Session | null;
  deleteSession(id: string): boolean;
  deleteSessionsByWorkspace(workspaceId: string): void;
  listSessionsByWorkspace(
    workspaceId: string,
    options?: { status?: SessionStatus; rootOnly?: boolean },
  ): Session[];
  listSessionsGrouped(
    workspaceIds: string[],
    options?: { status?: SessionStatus; rootOnly?: boolean },
  ): Record<string, Session[]>;
  listTagsByWorkspace(workspaceId: string): string[];
  getChildSessions(parentId: string): Session[];
  getSessionsByAgent(agentId: string, sinceTimestamp?: number, limit?: number): Session[];
  encodeSessionCursor(payload: SessionCursorPayload): string;
  decodeSessionCursor(cursor: string): SessionCursorPayload | null;
  listSessionPageByWorkspace(workspaceId: string, options: ListSessionPageOptions): SessionPage;
  listSessionPageGrouped(
    workspaceIds: string[],
    options: { status?: SessionStatus; rootOnly?: boolean; limitPerWorkspace: number },
  ): { sessions: Record<string, Session[]>; pagination: Record<string, SessionPageInfo> };
  readonly defaultPageSize: number;
  readonly maxPageSize: number;
  readonly minPageSize: number;
}

export type ToolInterruptReason = 'user_request' | 'timeout' | 'error' | 'cascade';

export interface StreamingPartSnapshot {
  id: string;
  messageId: string;
  sessionId: string;
  type: 'text' | 'reasoning';
  createdAt: number;
  text: string;
}

export interface TranscriptPageResult {
  messages: MessageWithParts[];
  pagination: {
    hasOlder: boolean;
    oldestSequence: number | null;
    newestSequence: number | null;
    limit: number;
  };
}

export interface CompactionBoundary {
  triggerId: string;
  triggerSequence: number;
  summaryId: string;
  summarySequence: number;
}

export interface MessageStorePort {
  createMessage(message: Message): Message;
  getMessage(id: string): Message | null;
  updateMessage(
    id: string,
    updates: Partial<Message>,
    options?: { syncFts?: boolean },
  ): Message | null;
  listMessages(sessionId: string): Message[];
  deleteMessages(sessionId: string): number;
  deleteMessage(messageId: string): boolean;

  createPart(part: Part, sessionId: string, options?: { syncFts?: boolean }): Part;
  getPart(id: string): Part | null;
  updatePart(
    id: string,
    updates: Record<string, unknown>,
    options?: { syncFts?: boolean },
  ): Part | null;
  getPartsByMessage(messageId: string): Part[];
  getPartsBySession(sessionId: string): Part[];
  getMessageWithParts(messageId: string): MessageWithParts | null;
  listMessagesWithParts(sessionId: string): MessageWithParts[];

  createToolPartPending(
    messageId: string,
    callId: string,
    toolName: string,
    input: Record<string, unknown>,
    sessionId: string,
  ): ToolPart;
  transitionToolToRunning(partId: string, childSessionId?: string): ToolPart | null;
  transitionToolToCompleted(partId: string, output: unknown): ToolPart | null;
  transitionToolToError(partId: string, error: string): ToolPart | null;
  getToolPartByCallId(sessionId: string, callId: string): ToolPart | null;
  transitionToolToRunningByCallId(
    sessionId: string,
    callId: string,
    childSessionId?: string,
  ): ToolPart | null;
  transitionToolToInterrupted(partId: string, reason: ToolInterruptReason): ToolPart | null;
  findOrphanedToolCalls(sessionId: string): ToolPart[];
  reconcileOrphanedToolCalls(sessionId: string): number;
  reconcileAllOrphanedToolCalls(): number;

  findOrphanedCompactionTriggers(sessionId: string): Message[];
  listMessagesForSession(sessionId: string): MessageWithParts[];
  getLatestCompactionBoundary(sessionId: string): CompactionBoundary | null;
  listMessagesWithPartsFromSequence(sessionId: string, sequence: number): MessageWithParts[];
  buildEffectiveContextHistory(sessionId: string): {
    messages: MessageWithParts[];
    latestCompactionBoundary: string | null;
    hasCompaction: boolean;
  };
  countMessagesInSession(sessionId: string): number;
  listLatestMessagesWithPartsPage(sessionId: string, limit?: number): TranscriptPageResult;
  listMessagesWithPartsBeforeSequence(
    sessionId: string,
    beforeSequence: number,
    limit?: number,
  ): TranscriptPageResult;

  syncMessageFts(messageId: string): void;
  persistStreamingPartSnapshot(snapshot: StreamingPartSnapshot): boolean;
  persistStreamingPartSnapshots(snapshots: StreamingPartSnapshot[]): number;
}

export type {
  AssistantMessage,
  Message,
  MessageWithParts,
  Part,
  Session,
  SessionStatus,
  SubagentStatus,
  SystemMessage,
  ToolPart,
  UserMessage,
};
