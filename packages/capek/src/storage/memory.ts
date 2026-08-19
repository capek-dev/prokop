import type { Message, MessageWithParts, Part, QueuedMessage, ResponseFormat, Session, ToolPart, Workspace } from '@capekai/types';
import { createInMemoryToolOutputArtifactStore } from './tool-output-artifacts';
import type {
  AttachmentRecord,
  AttachmentStore,
  ConversationIndex,
  ConversationStore,
  MessageQueueStore,
  ResponseFormatStore,
  SessionUpdates,
  StorageBundle,
  StreamingPartSnapshot,
  TranscriptPageResult,
  WorkspaceStore,
} from './contracts';

interface StoredMessage {
  message: Message;
  sequence: number;
}

interface StoredPart {
  part: Part;
  sessionId: string;
  insertionOrder: number;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function compareParts(left: Part, right: Part): number {
  return left.createdAt - right.createdAt;
}

export function createInMemoryConversationStore(): ConversationStore {
  const sessions = new Map<string, Session>();
  const messages = new Map<string, StoredMessage>();
  const parts = new Map<string, StoredPart>();
  const nextSequence = new Map<string, number>();
  let nextPartInsertionOrder = 0;

  const getPartsByMessage = (messageId: string): Part[] => [...parts.values()]
    .filter(record => record.part.messageId === messageId)
    .map(record => copy(record.part))
    .sort(compareParts);

  const orderedMessages = (sessionId: string): StoredMessage[] => [...messages.values()]
    .filter(record => record.message.sessionId === sessionId)
    .sort((left, right) => left.sequence - right.sequence);

  const listMessagesWithParts = (sessionId: string): MessageWithParts[] => orderedMessages(sessionId)
    .map(record => ({
      message: copy(record.message),
      parts: getPartsByMessage(record.message.id),
    }));

  const store: ConversationStore = {
    async createSession(input) {
      const now = new Date().toISOString();
      const session = copy({
        ...input,
        tags: input.tags ?? [],
        createdAt: input.createdAt || now,
        updatedAt: input.updatedAt || now,
      }) as Session;
      if (sessions.has(session.id)) throw new Error(`Session already exists: ${session.id}`);
      sessions.set(session.id, session);
      return copy(session);
    },
    async getSession(id) {
      const session = sessions.get(id);
      return session ? copy(session) : null;
    },
    async updateSession(id, updates: SessionUpdates) {
      const current = sessions.get(id);
      if (!current) return null;
      const updated = copy({ ...current, ...updates, updatedAt: new Date().toISOString() }) as Session;
      sessions.set(id, updated);
      return copy(updated);
    },
    async getChildSessions(parentId) {
      return [...sessions.values()]
        .filter(session => session.parentId === parentId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(copy);
    },
    async createMessage(message) {
      if (!sessions.has(message.sessionId)) throw new Error(`Session does not exist: ${message.sessionId}`);
      if (messages.has(message.id)) throw new Error(`Message already exists: ${message.id}`);
      const sequence = nextSequence.get(message.sessionId) ?? 1;
      nextSequence.set(message.sessionId, sequence + 1);
      messages.set(message.id, { message: copy(message), sequence });
      return copy(message);
    },
    async getMessage(id) {
      const record = messages.get(id);
      return record ? copy(record.message) : null;
    },
    async getMessageWithParts(messageId) {
      const record = messages.get(messageId);
      return record ? { message: copy(record.message), parts: getPartsByMessage(messageId) } : null;
    },
    async updateMessage(id, updates) {
      const current = messages.get(id);
      if (!current) return null;
      current.message = copy({ ...current.message, ...updates }) as Message;
      return copy(current.message);
    },
    async deleteMessage(messageId) {
      if (!messages.delete(messageId)) return false;
      for (const [id, record] of parts) {
        if (record.part.messageId === messageId) parts.delete(id);
      }
      return true;
    },
    async listMessagesWithParts(sessionId) { return listMessagesWithParts(sessionId); },
    async listLatestMessagesWithPartsPage(sessionId, limit = 50): Promise<TranscriptPageResult> {
      const effectiveLimit = Math.min(Math.max(limit, 1), 100);
      const ordered = orderedMessages(sessionId);
      const selected = ordered.slice(-effectiveLimit);
      return {
        messages: selected.map(record => ({
          message: copy(record.message),
          parts: getPartsByMessage(record.message.id),
        })),
        pagination: {
          hasOlder: ordered.length > selected.length,
          oldestSequence: selected[0]?.sequence ?? null,
          newestSequence: selected.at(-1)?.sequence ?? null,
          limit: effectiveLimit,
        },
      };
    },
    async buildEffectiveContextHistory(sessionId) {
      const ordered = orderedMessages(sessionId);
      let boundary: StoredMessage | undefined;
      for (let index = ordered.length - 1; index >= 0; index -= 1) {
        const candidate = ordered[index];
        const message = candidate.message;
        if (message.role !== 'assistant' || message.summary !== true || message.mode !== 'compaction' || !message.parentId) continue;
        const trigger = messages.get(message.parentId);
        if (!trigger || trigger.message.sessionId !== sessionId) continue;
        if (!getPartsByMessage(trigger.message.id).some(part => part.type === 'compaction')) continue;
        boundary = trigger;
        break;
      }
      const effective = boundary
        ? ordered.filter(record => record.sequence >= boundary.sequence)
        : ordered;
      return {
        messages: effective.map(record => ({
          message: copy(record.message),
          parts: getPartsByMessage(record.message.id),
        })),
        latestCompactionBoundary: boundary?.message.id ?? null,
        hasCompaction: Boolean(boundary),
      };
    },
    async createPart(part, sessionId) {
      const message = messages.get(part.messageId);
      if (!message || message.message.sessionId !== sessionId) throw new Error(`Message does not exist in session: ${part.messageId}`);
      if (parts.has(part.id)) throw new Error(`Part already exists: ${part.id}`);
      parts.set(part.id, {
        part: copy(part),
        sessionId,
        insertionOrder: nextPartInsertionOrder++,
      });
      return copy(part);
    },
    async getPart(id) {
      const record = parts.get(id);
      return record ? copy(record.part) : null;
    },
    async getPartsByMessage(messageId) {
      return getPartsByMessage(messageId);
    },
    async getPartsBySession(sessionId) {
      return [...parts.values()]
        .filter(record => record.sessionId === sessionId)
        .map(record => copy(record.part))
        .sort(compareParts);
    },
    async updatePart(id, updates) {
      const current = parts.get(id);
      if (!current) return null;
      current.part = copy({ ...current.part, ...updates }) as Part;
      return copy(current.part);
    },
    async persistStreamingPartSnapshots(snapshots: StreamingPartSnapshot[]) {
      let count = 0;
      for (const snapshot of snapshots) {
        const record = parts.get(snapshot.id);
        if (!record
          || record.part.messageId !== snapshot.messageId
          || record.sessionId !== snapshot.sessionId
          || record.part.type !== snapshot.type) continue;
        record.part = copy({ ...record.part, text: snapshot.text }) as Part;
        count += 1;
      }
      return count;
    },
    async transitionToolToRunningByCallId(sessionId, callId, childSessionId) {
      const candidates = [...parts.values()]
        .filter(record => record.sessionId === sessionId
          && record.part.type === 'tool'
          && record.part.callId === callId)
        .sort((left, right) => {
          const leftPart = left.part as ToolPart;
          const rightPart = right.part as ToolPart;
          return Number(rightPart.state.status === 'pending') - Number(leftPart.state.status === 'pending')
            || rightPart.createdAt - leftPart.createdAt
            || right.insertionOrder - left.insertionOrder;
        });
      const toolPart = candidates[0]?.part as ToolPart | undefined;
      if (!toolPart || toolPart.state.status !== 'pending') return null;
      return await store.updatePart(toolPart.id, {
        state: {
          status: 'running',
          input: toolPart.state.input,
          startedAt: Date.now(),
          ...(childSessionId ? { childSessionId } : {}),
        },
      }) as ToolPart;
    },
    async transitionToolToInterrupted(partId, reason) {
      const current = parts.get(partId)?.part;
      if (!current || current.type !== 'tool') return null;
      const now = Date.now();
      return await store.updatePart(partId, {
        state: {
          status: 'interrupted',
          input: current.state.input,
          startedAt: current.state.status === 'running' ? current.state.startedAt : now,
          interruptedAt: now,
          reason,
          ...('childSessionId' in current.state && current.state.childSessionId
            ? { childSessionId: current.state.childSessionId }
            : {}),
        },
      }) as ToolPart;
    },
  };

  return store;
}

export function createInMemoryMessageQueueStore(options: { attachments?: AttachmentStore } = {}): MessageQueueStore {
  const records = new Map<string, QueuedMessage>();
  let id = 0;
  return {
    async addMessage(sessionId, content, attachments) {
      const position = Math.max(-1, ...[...records.values()]
        .filter(record => record.sessionId === sessionId)
        .map(record => record.position)) + 1;
      const enriched: Array<{ id: string; kind: string; filename?: string; mimeType?: string; accessKey?: string }> | undefined = attachments ? [] : undefined;
      if (attachments && enriched) {
        for (const attachment of attachments) {
          const record = await options.attachments?.get(sessionId, attachment.id);
          enriched.push(record ? {
            ...attachment,
            filename: record.filename,
            mimeType: record.mimeType,
            accessKey: record.accessKey,
          } : attachment);
        }
      }
      const message: QueuedMessage = {
        id: `queue-${++id}`,
        sessionId,
        content,
        position,
        createdAt: Date.now(),
        ...(enriched ? { attachments: enriched } : {}),
      };
      records.set(message.id, copy(message));
      return copy(message);
    },
    async peek(sessionId) {
      const message = [...records.values()]
        .filter(record => record.sessionId === sessionId)
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))[0];
      return message ? copy(message) : null;
    },
    async delete(idToDelete) {
      return records.delete(idToDelete);
    },
  };
}

export interface InMemoryAuxiliaryRecords {
  attachments?: AttachmentRecord[];
  workspaces?: Workspace[];
  responseFormats?: ResponseFormat[];
}

export function createInMemoryStorageBundle(records: InMemoryAuxiliaryRecords = {}): StorageBundle {
  const attachments = new Map(records.attachments?.map(record => [`${record.sessionId}:${record.id}`, copy(record)]));
  const workspaces = new Map(records.workspaces?.map(record => [record.id, copy(record)]));
  const responseFormats = new Map(records.responseFormats?.map(record => [record.id, copy(record)]));
  const attachmentStore: AttachmentStore = {
    get: async (sessionId, attachmentId) => copy(attachments.get(`${sessionId}:${attachmentId}`) ?? null),
  };
  const workspaceStore: WorkspaceStore = {
    get: async id => copy(workspaces.get(id) ?? null),
    getAutoApproveSeverity: async id => workspaces.get(id)?.settings.autoApproveSeverity ?? 'low',
  };
  const responseFormatStore: ResponseFormatStore = {
    get: async id => copy(responseFormats.get(id) ?? null),
  };
  const index: ConversationIndex = { syncMessage: async () => {} };
  return {
    conversation: createInMemoryConversationStore(),
    toolOutputArtifacts: createInMemoryToolOutputArtifactStore(),
    queue: createInMemoryMessageQueueStore({ attachments: attachmentStore }),
    attachments: attachmentStore,
    workspaces: workspaceStore,
    responseFormats: responseFormatStore,
    index,
  };
}
