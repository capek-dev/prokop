import type {
  Ask,
  AskAuthority,
  AttachmentKind,
  AutoApproveSeverity,
  Message,
  MessageWithParts,
  Preconfig,
  QueuedMessage,
  Session,
  SessionStatus,
} from '@prokopai/sdk';

/** Structural copies of storage result shapes. The Jean2 repository
 * adapter maps store and Capek storage results onto these contracts. */
export interface SessionPageInfo {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

export interface ToolOutputArtifactPage {
  artifactId: string;
  toolCallId: string;
  toolName: string;
  format: 'json' | 'text';
  content: string;
  offset: number;
  limit: number;
  totalChars: number;
  nextOffset: number | null;
  complete: boolean;
}

/**
 * Pending ask record shape, structural copy of the store record. The Jean2
 * repository adapter maps store records onto this contract.
 */
export interface PendingAskRecord {
  id: string;
  requestId: string;
  sessionId: string;
  rootSessionId?: string;
  originSessionId?: string;
  workspaceId?: string;
  toolCallId: string;
  toolName: string;
  ask: Ask;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
  isPermission: boolean;
  expiresAt?: number;
  resolvedAt?: number;
  resolution?: unknown;
  createdAt: number;
}

export interface SessionRecordCreateInput {
  id: string;
  workspaceId: string;
  preconfigId: string | null;
  title: string;
  status: 'active';
  metadata: Record<string, unknown> | null;
  parentId: string | null;
  agentName: string | null;
  autoApproveSeverity?: AutoApproveSeverity;
}

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
    | 'parentId'
    | 'agentName'
    | 'subagentStatus'
    | 'runningAt'
    | 'tags'
    | 'autoApproveSeverity'
    | 'agentId'
  >
>;

export interface TranscriptPage {
  messages: MessageWithParts[];
  pagination: {
    hasOlder: boolean;
    oldestSequence: number | null;
    newestSequence: number | null;
    limit: number;
  };
}

export interface GroupedSessionPage {
  sessions: Record<string, Session[]>;
  pagination: Record<string, SessionPageInfo>;
}

export interface AttachmentRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  kind: AttachmentKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  absolutePath: string;
  createdAt: string;
  accessKey: string;
}

export interface AttachmentCreateInput {
  sessionId: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  data: ArrayBuffer;
}

/**
 * Repository port for session-scoped reads and writes. Every operation
 * delegates to the current storage implementation unchanged; there is no
 * transaction wrapper because the current implementation has none. The
 * awaited use-case promise is the honest completion boundary.
 */
export interface SessionRepositoryPort {
  createSession(input: SessionRecordCreateInput): Session;
  getSession(id: string): Session | null;
  updateSession(id: string, updates: SessionUpdateInput): Session | null;
  deleteSession(id: string): boolean;
  listSessions(status?: SessionStatus): Session[];
  /** Workspace sessions, updated_at descending; optional status and
   * root-only (parent_id IS NULL) filters. Delegates verbatim to the
   * current store query. */
  listSessionsByWorkspace(
    workspaceId: string,
    options?: { status?: SessionStatus; rootOnly?: boolean },
  ): Session[];
  /** Root sessions only (parent_id IS NULL), updated_at descending,
   * optional limit. Delegates verbatim to the current store query; no
   * store SQL changes. */
  listSessionsByAgent(agentId: string, limit?: number): Session[];
  listSessionsGrouped(
    workspaceIds: string[],
    options?: { status?: SessionStatus; rootOnly?: boolean },
  ): Record<string, Session[]>;
  listSessionPageGrouped(
    workspaceIds: string[],
    options: { status?: SessionStatus; rootOnly?: boolean; limitPerWorkspace: number },
  ): GroupedSessionPage;
  listTagsByWorkspace(workspaceId: string): string[];

  listMessages(sessionId: string): Message[];
  listLatestMessagesWithPartsPage(sessionId: string, limit: number): TranscriptPage;
  listMessagesWithPartsBeforeSequence(
    sessionId: string,
    beforeSequence: number,
    limit: number,
  ): TranscriptPage;
  reconcileCompaction(sessionId: string): Promise<number>;
  reconcileOrphanedToolCalls(sessionId: string): number;

  listQueuedMessages(sessionId: string): QueuedMessage[];
  addMessageToQueue(sessionId: string, content: string, attachments?: Array<{ id: string; kind: string }>): QueuedMessage;
  getQueuedMessage(id: string): QueuedMessage | null;
  deleteQueuedMessage(id: string): boolean;

  markManualSessionTitle(metadata: Record<string, unknown> | null | undefined): Record<string, unknown>;
  getWorkspaceAutoApproveSeverity(workspaceId: string): AutoApproveSeverity;
  getPreconfigOrAgent(id: string): Promise<Preconfig | null>;
  isAgentSync(id: string): boolean;

  toolOutput: {
    defaultPageChars: number;
    maxPageChars: number;
    isArtifactId(id: string): boolean;
    getPage(
      sessionId: string,
      artifactId: string,
      offset?: number,
      limit?: number,
    ): ToolOutputArtifactPage | null;
  };

  attachments: {
    maxSize: number;
    determineKind(mimeType: string): AttachmentKind;
    validateImageMime(mimeType: string): boolean;
    getByKey(attachmentId: string, accessKey: string): AttachmentRecord | null;
    listForSession(sessionId: string): AttachmentRecord[];
    create(input: AttachmentCreateInput): AttachmentRecord;
    readFileBuffer(record: AttachmentRecord): Buffer | null;
  };
}

/**
 * Inward-facing compaction recovery port (S5, paired with C6 step 2). The
 * Capek compaction domain owns the reconciliation decisions; the current
 * Jean2 store fulfills this port with its queries. Shapes are SDK structural
 * copies; no SQL crosses the boundary.
 */
export interface CompactionRecoveryPort {
  /** True when the session's compacting flag is set (a stuck state). */
  isSessionCompacting(sessionId: string): boolean;
  /** Clears the stuck compacting flag and returns the updated session, or
   * null when the session no longer exists. */
  clearSessionCompacting(sessionId: string): Session | null;
  /** Orphaned compaction triggers: user messages with a compaction part and
   * no assistant outcome (assistant message with parentId pointing at it). */
  listOrphanedCompactionTriggers(sessionId: string): Message[];
  /** All session ids for startup-wide reconciliation. */
  listSessionIds(): string[];
}

/**
 * Pending ask persistence. The implementation stays in the store until S4;
 * use cases only orchestrate the existing cleanup and sync order.
 */
export interface PendingAskPort {
  listAllPendingAsks(): PendingAskRecord[];
  listPendingRequestsByRootSession(rootSessionId: string): PendingAskRecord[];
  cleanupAllPendingAsks(maxAgeMs?: number): number;
}

/**
 * Ask authority resolution and timeout. The policy implementation stays in
 * Capek until S4; the adapter fulfills this port with the compat entrypoints.
 */
export interface AskAuthorityPort {
  timeoutMs: number;
  getAuthorityForPendingAsk(toolCallId: string): AskAuthority | undefined;
}
