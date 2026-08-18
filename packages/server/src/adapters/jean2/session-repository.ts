import {
  createSession,
  deleteSession,
  getSession,
  getSessionsByAgent,
  listSessions,
  listSessionsByWorkspace,
  listSessionsGrouped,
  listSessionPageGrouped,
  listTagsByWorkspace,
  updateSession,
} from '@/infrastructure/sqlite/session-store';
import {
  listMessages,
  listLatestMessagesWithPartsPage,
  listMessagesWithPartsBeforeSequence,
  reconcileOrphanedToolCalls,
} from '@/infrastructure/sqlite/message-store';
import { reconcileSessionCompaction } from '@/adapters/capek/compaction-recovery';
import {
  listQueuedMessages,
  addMessageToQueue,
  getQueuedMessage,
  deleteQueuedMessage,
} from '@/infrastructure/sqlite/queued-messages';
import {
  DEFAULT_TOOL_OUTPUT_PAGE_CHARS,
  getToolOutputArtifactPage,
  isToolOutputArtifactId,
  MAX_TOOL_OUTPUT_PAGE_CHARS,
} from '@/infrastructure/sqlite/tool-output-artifacts';
import {
  createAttachment,
  determineKind,
  getAttachmentByKey,
  getAttachmentsForSession,
  MAX_ATTACHMENT_SIZE,
  validateImageMime,
  type Attachment,
} from '@/infrastructure/sqlite/attachments';
import { getWorkspaceAutoApproveSeverity } from '@/infrastructure/sqlite/workspaces';
import { getPreconfigOrAgent, isAgentSync } from '@/agents/storage';
import { markManualSessionTitle } from '@/infrastructure/session-title';
import {
  cleanupAllPendingAsks,
  listAllPendingAsks,
  listPendingRequestsByRootSession,
} from '@/infrastructure/sqlite/pending-asks';
import { existsSync, readFileSync } from 'fs';
import type {
  AttachmentRecord,
  GroupedSessionPage,
  PendingAskPort,
  SessionRecordCreateInput,
  SessionRepositoryPort,
  SessionUpdateInput,
  TranscriptPage,
} from '@/application/ports/session';
import type {
  MessageWithParts,
  QueuedMessage,
  Session,
  SessionStatus,
} from '@jean2/sdk';
import type { Preconfig } from '@jean2/sdk';
import type { SessionPageInfo, ToolOutputArtifactPage as SessionToolOutputArtifactPage } from '@/application/ports/session';

function toTranscriptPage(result: {
  messages: MessageWithParts[];
  pagination: {
    hasOlder: boolean;
    oldestSequence: number | null;
    newestSequence: number | null;
    limit: number;
  };
}): TranscriptPage {
  return {
    messages: result.messages,
    pagination: {
      hasOlder: result.pagination.hasOlder,
      oldestSequence: result.pagination.oldestSequence,
      newestSequence: result.pagination.newestSequence,
      limit: result.pagination.limit,
    },
  };
}

function toGroupedSessionPage(result: {
  sessions: Record<string, Session[]>;
  pagination: Record<string, SessionPageInfo>;
}): GroupedSessionPage {
  return {
    sessions: result.sessions,
    pagination: result.pagination,
  };
}

function toAttachmentRecord(attachment: Attachment): AttachmentRecord {
  return {
    id: attachment.id,
    sessionId: attachment.sessionId,
    workspaceId: attachment.workspaceId,
    kind: attachment.kind,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    absolutePath: attachment.absolutePath,
    createdAt: attachment.createdAt,
    accessKey: attachment.accessKey,
  };
}

function toCreateInput(input: SessionRecordCreateInput) {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    preconfigId: input.preconfigId,
    title: input.title,
    status: input.status,
    metadata: input.metadata,
    parentId: input.parentId,
    agentName: input.agentName,
    ...(input.autoApproveSeverity !== undefined
      ? { autoApproveSeverity: input.autoApproveSeverity }
      : {}),
  };
}

/**
 * Jean2 session repository adapter (S3).
 *
 * Fulfills the application repository port with the current store
 * implementations. Every function delegates live to the store module, so
 * test database reconfiguration and sandbox singleton state keep working
 * exactly as before. No transaction wrapper is introduced because the
 * current implementation has none.
 */
export function createJean2SessionRepository(): SessionRepositoryPort {
  return {
    createSession(input: SessionRecordCreateInput): Session {
      return createSession(toCreateInput(input));
    },

    getSession(id: string): Session | null {
      return getSession(id);
    },

    updateSession(id: string, updates: SessionUpdateInput): Session | null {
      return updateSession(id, updates);
    },

    deleteSession(id: string): boolean {
      return deleteSession(id);
    },

    listSessions(status?: SessionStatus): Session[] {
      return listSessions(status);
    },

    listSessionsByWorkspace(workspaceId, options): Session[] {
      return listSessionsByWorkspace(workspaceId, options);
    },

    listSessionsByAgent(agentId: string, limit?: number): Session[] {
      return getSessionsByAgent(agentId, undefined, limit);
    },

    listSessionsGrouped(workspaceIds, options) {
      return listSessionsGrouped(workspaceIds, options);
    },

    listSessionPageGrouped(workspaceIds, options): GroupedSessionPage {
      return toGroupedSessionPage(listSessionPageGrouped(workspaceIds, options));
    },

    listTagsByWorkspace(workspaceId: string): string[] {
      return listTagsByWorkspace(workspaceId);
    },

    listMessages(sessionId: string) {
      return listMessages(sessionId);
    },

    listLatestMessagesWithPartsPage(sessionId: string, limit: number): TranscriptPage {
      return toTranscriptPage(listLatestMessagesWithPartsPage(sessionId, limit));
    },

    listMessagesWithPartsBeforeSequence(
      sessionId: string,
      beforeSequence: number,
      limit: number,
    ): TranscriptPage {
      return toTranscriptPage(listMessagesWithPartsBeforeSequence(sessionId, beforeSequence, limit));
    },

    reconcileCompaction(sessionId: string): number {
      return reconcileSessionCompaction(sessionId);
    },

    reconcileOrphanedToolCalls(sessionId: string): number {
      return reconcileOrphanedToolCalls(sessionId);
    },

    listQueuedMessages(sessionId: string): QueuedMessage[] {
      return listQueuedMessages(sessionId);
    },

    addMessageToQueue(
      sessionId: string,
      content: string,
      attachments?: Array<{ id: string; kind: string }>,
    ): QueuedMessage {
      return addMessageToQueue(sessionId, content, attachments);
    },

    getQueuedMessage(id: string): QueuedMessage | null {
      return getQueuedMessage(id);
    },

    deleteQueuedMessage(id: string): boolean {
      return deleteQueuedMessage(id);
    },

    markManualSessionTitle(metadata) {
      return markManualSessionTitle(metadata);
    },

    getWorkspaceAutoApproveSeverity(workspaceId: string) {
      return getWorkspaceAutoApproveSeverity(workspaceId);
    },

    async getPreconfigOrAgent(id: string): Promise<Preconfig | null> {
      return getPreconfigOrAgent(id);
    },

    isAgentSync(id: string): boolean {
      return isAgentSync(id);
    },

    toolOutput: {
      defaultPageChars: DEFAULT_TOOL_OUTPUT_PAGE_CHARS,
      maxPageChars: MAX_TOOL_OUTPUT_PAGE_CHARS,
      isArtifactId(id: string): boolean {
        return isToolOutputArtifactId(id);
      },
      getPage(
        sessionId: string,
        artifactId: string,
        offset?: number,
        limit?: number,
      ): SessionToolOutputArtifactPage | null {
        return getToolOutputArtifactPage(sessionId, artifactId, offset, limit);
      },
    },

    attachments: {
      maxSize: MAX_ATTACHMENT_SIZE,
      determineKind(mimeType: string) {
        return determineKind(mimeType);
      },
      validateImageMime(mimeType: string): boolean {
        return validateImageMime(mimeType);
      },
      getByKey(attachmentId: string, accessKey: string): AttachmentRecord | null {
        const attachment = getAttachmentByKey(attachmentId, accessKey);
        return attachment ? toAttachmentRecord(attachment) : null;
      },
      listForSession(sessionId: string): AttachmentRecord[] {
        return getAttachmentsForSession(sessionId).map(toAttachmentRecord);
      },
      create(input): AttachmentRecord {
        return toAttachmentRecord(createAttachment(input));
      },
      readFileBuffer(record: AttachmentRecord): Buffer | null {
        if (!existsSync(record.absolutePath)) return null;
        return readFileSync(record.absolutePath);
      },
    },
  };
}

export function createJean2PendingAskPort(): PendingAskPort {
  return {
    listAllPendingAsks() {
      return listAllPendingAsks();
    },
    listPendingRequestsByRootSession(rootSessionId: string) {
      return listPendingRequestsByRootSession(rootSessionId);
    },
    cleanupAllPendingAsks(maxAgeMs?: number): number {
      return cleanupAllPendingAsks(maxAgeMs);
    },
  };
}
