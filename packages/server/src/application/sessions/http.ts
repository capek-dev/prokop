import type {
  AutoApproveSeverity,
  Message,
  Session,
  SessionHarness,
  CodexModel,
  CodexModelSelection,
  SessionStatus,
  SessionListFilter,
} from '@prokopai/sdk';
import type {
  AttachmentRecord,
  GroupedSessionPage,
  SessionRepositoryPort,
  ToolOutputArtifactPage,
  TranscriptPage,
} from '../ports/session';
import type { ToolCatalogPort } from '../ports/tool-catalog';
import type { WorktreeAttachmentRefreshPort } from '../ports/worktree';
import {
  getToolDebugData,
  projectMessagesForClient,
  type ToolDebugData,
} from './tool-debug';
import { checkHarnessCreate } from './harness-policy';

export interface SessionHttpCreateInput {
  id?: string;
  workspaceId?: string;
  workspaceRootId?: string;
  harness?: SessionHarness;
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

export interface CodexModelPort {
  list(): Promise<CodexModel[]>;
  get(sessionId: string): CodexModelSelection | null;
  save(sessionId: string, selection: CodexModelSelection): void;
  isActive(sessionId: string): boolean;
}

export interface SessionHttpApplication {
  codexAvailable(): boolean;
  codexCatalog(): Promise<CodexModel[]> | null;
  createSessionError(input: SessionHttpCreateInput): string | null;
  codexModels(sessionId: string): Promise<{ models: CodexModel[]; selection: CodexModelSelection | null }> | null;
  setCodexModel(sessionId: string, selection: CodexModelSelection): Promise<'ok' | 'not_found' | 'invalid' | 'active'>;
  listSessions(status?: SessionStatus): Session[];
  createSession(input: SessionHttpCreateInput): Session | null;
  listSessionsGrouped(
    workspaceIds: string[],
    options?: SessionListFilter,
  ): Record<string, Session[]>;
  listSessionPageGrouped(
    workspaceIds: string[],
    options: SessionListFilter & { limitPerWorkspace: number },
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
  workspaceRoots?: {
    isAvailable(workspaceId: string, workspaceRootId: string): boolean;
  },
  worktreeAttachments?: WorktreeAttachmentRefreshPort,
  codexAvailable: () => boolean = () => false,
  codexWorkspaceAvailable: (workspaceId: string) => boolean = () => false,
  codexModels?: CodexModelPort,
): SessionHttpApplication {
  return {
    codexAvailable,
    codexCatalog() {
      return codexAvailable() && codexModels ? codexModels.list() : null;
    },
    codexModels(sessionId) {
      if (repository.getSession(sessionId)?.harness !== 'codex-cli' || !codexModels) return null;
      return codexModels.list().then(models => ({ models, selection: codexModels.get(sessionId) }));
    },
    async setCodexModel(sessionId, selection) {
      if (repository.getSession(sessionId)?.harness !== 'codex-cli' || !codexModels) return 'not_found';
      if (codexModels.isActive(sessionId)) return 'active';
      const models = await codexModels.list();
      const model = models.find(item => item.model === selection.model);
      if (!model || !model.supportedEfforts.includes(selection.effort)) return 'invalid';
      if (codexModels.isActive(sessionId)) return 'active';
      if (repository.getSession(sessionId)?.harness !== 'codex-cli') return 'not_found';
      codexModels.save(sessionId, selection);
      return 'ok';
    },
    listSessions(status) {
      return repository.listSessions(status);
    },

    createSessionError(input) {
      const decision = checkHarnessCreate(input, { codexAvailable, codexWorkspaceAvailable, workspaceRoots });
      return decision.ok ? null : decision.message;
    },
    createSession(input) {
      const decision = checkHarnessCreate(input, { codexAvailable, codexWorkspaceAvailable, workspaceRoots });
      if (!decision.ok) return null;
      const workspaceId = input.workspaceId || '';
      const session = repository.createSession({
        id: input.id || crypto.randomUUID(),
        workspaceId,
        workspaceRootId: input.workspaceRootId ?? null,
        harness: decision.harness,
        preconfigId: input.preconfigId || null,
        title: input.title || 'New Session',
        status: 'active',
        metadata: input.metadata || null,
        parentId: null,
        agentName: null,
      });
      if (session.workspaceRootId) worktreeAttachments?.changed(session.workspaceRootId);
      return session;
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
      const updated = repository.updateSession(id, {
        title: input.title,
        status: input.status,
        metadata: input.title !== undefined
          ? repository.markManualSessionTitle(input.metadata ?? existing?.metadata)
          : input.metadata,
        tags: input.tags,
        autoApproveSeverity: input.autoApproveSeverity,
      });
      if (updated?.workspaceRootId) worktreeAttachments?.changed(updated.workspaceRootId);
      return updated;
    },

    deleteSession(id) {
      const existing = repository.getSession(id);
      const deleted = repository.deleteSession(id);
      if (deleted && existing?.workspaceRootId) {
        worktreeAttachments?.changed(existing.workspaceRootId);
      }
      return deleted;
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
