import type {
  AutoApproveSeverity,
  Message,
  MessageWithParts,
  Part,
  QueuedMessage,
  ResponseFormat,
  Session,
  ToolPart,
  Workspace,
} from '@jean2/sdk';
import type { AttachmentKind } from '@jean2/sdk';

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
  createSession(session: Omit<Session, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }): Session;
  getSession(id: string): Session | null;
  updateSession(id: string, updates: SessionUpdates): Session | null;
  getChildSessions(parentId: string): Session[];
  createMessage(message: Message): Message;
  getMessage(id: string): Message | null;
  getMessageWithParts(messageId: string): MessageWithParts | null;
  updateMessage(id: string, updates: Partial<Message>): Message | null;
  deleteMessage(messageId: string): boolean;
  listMessagesWithParts(sessionId: string): MessageWithParts[];
  listLatestMessagesWithPartsPage(sessionId: string, limit?: number): TranscriptPageResult;
  buildEffectiveContextHistory(sessionId: string): EffectiveContextHistory;
  createPart(part: Part, sessionId: string): Part;
  getPart(id: string): Part | null;
  getPartsByMessage(messageId: string): Part[];
  getPartsBySession(sessionId: string): Part[];
  updatePart(id: string, updates: Record<string, unknown>): Part | null;
  persistStreamingPartSnapshots(snapshots: StreamingPartSnapshot[]): number;
  transitionToolToRunningByCallId(sessionId: string, callId: string, childSessionId?: string): ToolPart | null;
  transitionToolToInterrupted(partId: string, reason: 'user_request' | 'timeout' | 'error' | 'cascade'): ToolPart | null;
}

export interface MessageQueueStore {
  addMessage(sessionId: string, content: string, attachments?: Array<{ id: string; kind: string }>): QueuedMessage;
  peek(sessionId: string): QueuedMessage | null;
  delete(id: string): boolean;
}

export interface AttachmentStore {
  get(sessionId: string, attachmentId: string): AttachmentRecord | null;
}

export interface WorkspaceStore {
  get(id: string): Workspace | null;
  getAutoApproveSeverity(workspaceId: string): AutoApproveSeverity;
}

export interface ResponseFormatStore {
  get(id: string): ResponseFormat | null;
}

export interface ConversationIndex {
  syncMessage(messageId: string): void;
  removeMessage?(messageId: string): void;
}

export interface StorageBundle {
  conversation: ConversationStore;
  queue: MessageQueueStore;
  attachments: AttachmentStore;
  workspaces: WorkspaceStore;
  responseFormats: ResponseFormatStore;
  index: ConversationIndex;
}

export interface ClosableStore {
  close(): void;
}
