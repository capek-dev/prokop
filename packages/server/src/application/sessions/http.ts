import type {
  AutoApproveSeverity,
  Message,
  Session,
  SessionStatus,
} from '@prokopai/sdk';
import type {
  AttachmentRecord,
  GroupedSessionPage,
  SessionRepositoryPort,
  ToolOutputArtifactPage,
  TranscriptPage,
} from '../ports/session';
import type { ToolCatalogPort } from '../ports/tool-distribution';
import {
  getToolDebugData,
  projectMessagesForClient,
  type ToolDebugData,
} from './tool-debug';

export interface SessionHttpCreateInput {
  id?: string;
  workspaceId?: string;
  preconfigId?: string | null;
  title?: string;
  metadata?: Record<string, unknown> | null;
}

export interface SessionHttpUpdateInput {
  title?: string | null;
  status?: SessionStatus;
  metadata?: Record<string, unknown> | null;
  tags?: string[];
  autoApproveSeverity?: AutoApproveSeverity | null;
}

export interface SessionHttpAttachmentCreateInput {
  sessionId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  data: ArrayBuffer;
}

export interface SessionHttpApplication {
  listSessions(status?: SessionStatus): Session[];
  createSession(input: SessionHttpCreateInput): Session;
  listSessionsGrouped(
    workspaceIds: string[],
    options?: { status?: SessionStatus; rootOnly?: boolean },
  ): Record<string, Session[]>;
  listSessionPageGrouped(
    workspaceIds: string[],
    options: { status?: SessionStatus; rootOnly?: boolean; limitPerWorkspace: number },
  ): GroupedSessionPage;
  listTagsByWorkspace(workspaceId: string): string[];

  getSession(id: string): Session | null;
  updateSession(id: string, input: SessionHttpUpdateInput): Session | null;
  deleteSession(id: string): boolean;

  listMessages(sessionId: string): Message[];
  latestTranscript(sessionId: string, limit: number): Promise<TranscriptPage>;
  transcriptBefore(sessionId: string, beforeSequence: number, limit: number): Promise<TranscriptPage>;
  getToolDebug(sessionId: string, partId: string): ToolDebugData | null;
  getToolOutputArtifactPage(
    sessionId: string,
    artifactId: string,
    offset?: number,
    limit?: number,
  ): ToolOutputArtifactPage | null;

  listAttachments(sessionId: string): AttachmentRecord[];
  createAttachment(input: SessionHttpAttachmentCreateInput): AttachmentRecord | null;
  getAttachmentByKey(attachmentId: string, accessKey: string): AttachmentRecord | null;
  readAttachmentFile(record: AttachmentRecord): Buffer | null;

  toolOutputLimits(): { defaultPageChars: number; maxPageChars: number };
  isToolOutputArtifactId(id: string): boolean;
  attachmentRules(): {
    maxSize: number;
    determineKind(mimeType: string): string;
    validateImageMime(mimeType: string): boolean;
  };
}

export function createSessionHttpApplication(
  repository: SessionRepositoryPort,
  toolCatalog?: Pick<ToolCatalogPort, 'listTools'>,
): SessionHttpApplication {
  return {
    listSessions(status) {
      return repository.listSessions(status);
    },

    createSession(input) {
      return repository.createSession({
        id: input.id || crypto.randomUUID(),
        workspaceId: input.workspaceId || '',
        preconfigId: input.preconfigId || null,
        title: input.title || 'New Session',
        status: 'active',
        metadata: input.metadata || null,
        parentId: null,
        agentName: null,
      });
    },

    listSessionsGrouped(workspaceIds, options) {
      return repository.listSessionsGrouped(workspaceIds, options);
    },

    listSessionPageGrouped(workspaceIds, options) {
      return repository.listSessionPageGrouped(workspaceIds, options);
    },

    listTagsByWorkspace(workspaceId) {
      return repository.listTagsByWorkspace(workspaceId);
    },

    getSession(id) {
      return repository.getSession(id);
    },

    updateSession(id, input) {
      const existing = repository.getSession(id);
      return repository.updateSession(id, {
        title: input.title,
        status: input.status,
        metadata: input.title !== undefined
          ? repository.markManualSessionTitle(input.metadata ?? existing?.metadata)
          : input.metadata,
        tags: input.tags,
        autoApproveSeverity: input.autoApproveSeverity,
      });
    },

    deleteSession(id) {
      return repository.deleteSession(id);
    },

    listMessages(sessionId) {
      return repository.listMessages(sessionId);
    },

    async latestTranscript(sessionId, limit) {
      const page = repository.listLatestMessagesWithPartsPage(sessionId, limit);
      return {
        ...page,
        messages: await projectMessagesForClient(page.messages, toolCatalog),
      };
    },

    async transcriptBefore(sessionId, beforeSequence, limit) {
      const page = repository.listMessagesWithPartsBeforeSequence(sessionId, beforeSequence, limit);
      return {
        ...page,
        messages: await projectMessagesForClient(page.messages, toolCatalog),
      };
    },

    getToolDebug(sessionId, partId) {
      const part = repository.getToolPart(sessionId, partId);
      return part ? getToolDebugData(part) : null;
    },

    getToolOutputArtifactPage(sessionId, artifactId, offset, limit) {
      return repository.toolOutput.getPage(sessionId, artifactId, offset, limit);
    },

    listAttachments(sessionId) {
      return repository.attachments.listForSession(sessionId);
    },

    createAttachment(input) {
      const session = repository.getSession(input.sessionId);
      if (!session) return null;
      return repository.attachments.create({
        sessionId: input.sessionId,
        workspaceId: session.workspaceId,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        data: input.data,
      });
    },

    getAttachmentByKey(attachmentId, accessKey) {
      return repository.attachments.getByKey(attachmentId, accessKey);
    },

    readAttachmentFile(record) {
      return repository.attachments.readFileBuffer(record);
    },

    toolOutputLimits() {
      return {
        defaultPageChars: repository.toolOutput.defaultPageChars,
        maxPageChars: repository.toolOutput.maxPageChars,
      };
    },

    isToolOutputArtifactId(id) {
      return repository.toolOutput.isArtifactId(id);
    },

    attachmentRules() {
      return {
        maxSize: repository.attachments.maxSize,
        determineKind: repository.attachments.determineKind,
        validateImageMime: repository.attachments.validateImageMime,
      };
    },
  };
}
