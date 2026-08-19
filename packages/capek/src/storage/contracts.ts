import type { AutoApproveSeverity, Message, MessageWithParts, Part, QueuedMessage, ResponseFormat, Session, ToolPart, Workspace } from '@capekai/types';
import type { AttachmentKind } from '@capekai/types';

export interface StreamingPartSnapshot {
  id: string;
  messageId: string;
  sessionId: string;
  type: 'text' | 'reasoning';
  createdAt: number;
  text: string;
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

export interface EffectiveContextHistory {
  messages: MessageWithParts[];
  latestCompactionBoundary: string | null;
  hasCompaction: boolean;
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

export type SessionUpdates = Partial<Pick<Session,
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
>>;

export interface ConversationStore {
  createSession(session: Omit<Session, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  updateSession(id: string, updates: SessionUpdates): Promise<Session | null>;
  getChildSessions(parentId: string): Promise<Session[]>;
  createMessage(message: Message): Promise<Message>;
  getMessage(id: string): Promise<Message | null>;
  getMessageWithParts(messageId: string): Promise<MessageWithParts | null>;
  updateMessage(id: string, updates: Partial<Message>): Promise<Message | null>;
  deleteMessage(messageId: string): Promise<boolean>;
  listMessagesWithParts(sessionId: string): Promise<MessageWithParts[]>;
  listLatestMessagesWithPartsPage(sessionId: string, limit?: number): Promise<TranscriptPageResult>;
  buildEffectiveContextHistory(sessionId: string): Promise<EffectiveContextHistory>;
  createPart(part: Part, sessionId: string): Promise<Part>;
  getPart(id: string): Promise<Part | null>;
  getPartsByMessage(messageId: string): Promise<Part[]>;
  getPartsBySession(sessionId: string): Promise<Part[]>;
  updatePart(id: string, updates: Record<string, unknown>): Promise<Part | null>;
  persistStreamingPartSnapshots(snapshots: StreamingPartSnapshot[]): Promise<number>;
  transitionToolToRunningByCallId(sessionId: string, callId: string, childSessionId?: string): Promise<ToolPart | null>;
  transitionToolToInterrupted(partId: string, reason: 'user_request' | 'timeout' | 'error' | 'cascade'): Promise<ToolPart | null>;
}

export type ToolOutputArtifactFormat = 'json' | 'text';

export interface ToolOutputArtifact {
  id: string;
  sessionId: string;
  workspaceId?: string;
  toolCallId: string;
  toolName: string;
  content: string;
  format: ToolOutputArtifactFormat;
  size: number;
  createdAt: number;
}

export type CreateToolOutputArtifact = Omit<ToolOutputArtifact, 'id' | 'size' | 'createdAt'>;

export interface ToolOutputArtifactPage {
  artifactId: string;
  toolCallId: string;
  toolName: string;
  format: ToolOutputArtifactFormat;
  content: string;
  offset: number;
  limit: number;
  totalChars: number;
  nextOffset: number | null;
  complete: boolean;
}

export interface ToolOutputArtifactStore {
  create(input: CreateToolOutputArtifact): Promise<ToolOutputArtifact>;
  getPage(sessionId: string, artifactId: string, offset?: number, limit?: number): Promise<ToolOutputArtifactPage | null>;
}

export interface MessageQueueStore {
  addMessage(sessionId: string, content: string, attachments?: Array<{ id: string; kind: string }>): Promise<QueuedMessage>;
  peek(sessionId: string): Promise<QueuedMessage | null>;
  delete(id: string): Promise<boolean>;
}

export interface AttachmentStore {
  get(sessionId: string, attachmentId: string): Promise<AttachmentRecord | null>;
}

export interface WorkspaceStore {
  get(id: string): Promise<Workspace | null>;
  getAutoApproveSeverity(workspaceId: string): Promise<AutoApproveSeverity>;
}

export interface ResponseFormatStore {
  get(id: string): Promise<ResponseFormat | null>;
}

export interface ConversationIndex {
  syncMessage(messageId: string): Promise<void>;
  removeMessage?(messageId: string): Promise<void>;
}

export interface StorageBundle {
  conversation: ConversationStore;
  toolOutputArtifacts: ToolOutputArtifactStore;
  queue: MessageQueueStore;
  attachments: AttachmentStore;
  workspaces: WorkspaceStore;
  responseFormats: ResponseFormatStore;
  index: ConversationIndex;
}

export interface ClosableStore {
  close(): void;
}
