import type {
  Message,
  PermissionMode,
  Session,
  SessionHarness,
  CodexModel,
  CodexModelSelection,
  HarnessUsageLimits,
  SessionStatus,
  SessionListFilter,
} from '@prokopai/sdk';
import type {
  AttachmentRecord,
  GroupedSessionPage,
  SessionRepositoryPort,
  ToolOutputArtifactPage,
  TranscriptPage,
} from '@/application/ports/session';
import type { ToolCatalogPort } from '@/application/ports/tool-catalog';
import type { WorktreeAttachmentRefreshPort } from '@/application/ports/worktree';
import type { HarnessSettingsApplication } from '@/application/harnesses/settings';
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
  permissionMode?: PermissionMode | null;
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

export interface HarnessStatusEntry {
  id: SessionHarness;
  available: boolean;
  enabled: boolean;
  version: string | null;
  approvals: boolean;
}

/** Harness registry wiring: persisted enablement plus optional CLI version probes. */
export interface SessionHarnessSettingsDeps {
  settings: HarnessSettingsApplication;
  codexVersion?: () => string;
  claudeVersion?: () => string;
  /** Plan usage reads per native harness; Prokop has none. */
  usage?: Partial<Record<HarnessUsageLimits['harness'], () => Promise<HarnessUsageLimits>>>;
}

/** Tells every connected client about sessions changed over HTTP, so their lists follow. */
export interface SessionChangeBroadcast {
  created(session: Session): void;
  updated(session: Session): void;
  deleted(sessionId: string): void;
}

export interface SessionHttpApplication {
  codexAvailable(): boolean;
  claudeAvailable(): boolean;
  listHarnessStatuses(): HarnessStatusEntry[];
  setHarnessEnabled(harness: SessionHarness, enabled: boolean): 'ok' | 'not_found' | 'prokop_immutable';
  /** Null when the harness CLI is not installed or has no usage reader. */
  harnessUsage(harness: HarnessUsageLimits['harness']): Promise<HarnessUsageLimits> | null;
  claudeCatalog(): Promise<CodexModel[]> | null;
  claudeModels(sessionId: string): Promise<{ models: CodexModel[]; selection: CodexModelSelection | null }> | null;
  setClaudeModel(sessionId: string, selection: CodexModelSelection): Promise<'ok' | 'not_found' | 'invalid' | 'active'>;
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
  createAttachment(input: SessionHttpAttachmentCreateInput): Promise<AttachmentRecord | null>;
  getAttachmentByKey(attachmentId: string, accessKey: string): AttachmentRecord | null;
  openAttachmentFile(record: AttachmentRecord): Promise<Blob | null>;

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
  claudeAvailable: () => boolean = () => false,
  claudeModels?: CodexModelPort,
  claudeWorkspaceAvailable: (workspaceId: string) => boolean = () => false,
  harnessSettings?: SessionHarnessSettingsDeps,
  changes?: SessionChangeBroadcast,
): SessionHttpApplication {
  const harnessVersion = (probe: (() => string) | undefined, available: boolean): string | null => {
    if (!available || !probe) return null;
    try {
      return probe();
    } catch {
      return null;
    }
  };
  return {
    codexAvailable,
    claudeAvailable,
    listHarnessStatuses() {
      return [
        { id: 'prokop' as const, available: true, enabled: true, version: null, approvals: true },
        {
          id: 'codex-cli' as const,
          available: codexAvailable(),
          enabled: !harnessSettings?.settings.isDisabled('codex-cli'),
          version: harnessVersion(harnessSettings?.codexVersion, codexAvailable()),
          approvals: false,
        },
        {
          id: 'claude-cli' as const,
          available: claudeAvailable(),
          enabled: !harnessSettings?.settings.isDisabled('claude-cli'),
          version: harnessVersion(harnessSettings?.claudeVersion, claudeAvailable()),
          approvals: false,
        },
      ];
    },
    setHarnessEnabled(harness, enabled) {
      if (!harnessSettings) return 'not_found';
      return harnessSettings.settings.setEnabled(harness, enabled).kind;
    },
    harnessUsage(harness) {
      const available = harness === 'codex-cli' ? codexAvailable() : claudeAvailable();
      const read = harnessSettings?.usage?.[harness];
      return available && read ? read() : null;
    },
    claudeCatalog() {
      return claudeAvailable() && claudeModels ? claudeModels.list() : null;
    },
    claudeModels(sessionId) {
      if (repository.getSession(sessionId)?.harness !== 'claude-cli' || !claudeModels) return null;
      return claudeModels.list().then(models => ({ models, selection: claudeModels.get(sessionId) }));
    },
    async setClaudeModel(sessionId, selection) {
      if (repository.getSession(sessionId)?.harness !== 'claude-cli' || !claudeModels) return 'not_found';
      if (claudeModels.isActive(sessionId)) return 'active';
      const models = await claudeModels.list();
      if (!models.some(model => model.model === selection.model && model.supportedEfforts.includes(selection.effort))) return 'invalid';
      if (claudeModels.isActive(sessionId)) return 'active';
      if (repository.getSession(sessionId)?.harness !== 'claude-cli') return 'not_found';
      claudeModels.save(sessionId, selection);
      return 'ok';
    },
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
      const decision = checkHarnessCreate(input, { codexAvailable, codexWorkspaceAvailable,
        claudeAvailable, claudeWorkspaceAvailable, workspaceRoots,
        isHarnessDisabled: harnessSettings?.settings.isDisabled });
      return decision.ok ? null : decision.message;
    },
    createSession(input) {
      const decision = checkHarnessCreate(input, { codexAvailable, codexWorkspaceAvailable,
        claudeAvailable, claudeWorkspaceAvailable, workspaceRoots,
        isHarnessDisabled: harnessSettings?.settings.isDisabled });
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
      changes?.created(session);
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
        permissionMode: input.permissionMode,
      });
      if (updated?.workspaceRootId) worktreeAttachments?.changed(updated.workspaceRootId);
      if (updated) changes?.updated(updated);
      return updated;
    },

    deleteSession(id) {
      const existing = repository.getSession(id);
      const deleted = repository.deleteSession(id);
      if (deleted && existing?.workspaceRootId) {
        worktreeAttachments?.changed(existing.workspaceRootId);
      }
      if (deleted) changes?.deleted(id);
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

    async createAttachment(input) {
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

    openAttachmentFile(record) {
      return repository.attachments.openFile(record);
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
