import type { Message, MessageWithParts, Part, Session } from '@capekai/types';
import {
  createMessage,
  createPart,
  createSession,
  getSession,
  getWorkspaceAutoApproveSeverity,
  listMessagesWithParts,
} from '../storage/runtime';

interface ForkOptions {
  sessionId: string;
  targetMessageId: string;
  title?: string;
}

interface ForkResult {
  forkedSession: Session;
  messages: MessageWithParts[];
}

function generateId(): string {
  return crypto.randomUUID();
}

function copyMessage(
  message: Message,
  newSessionId: string,
  newMessageId: string,
  idMap: Map<string, string>,
): Message {
  if (message.role === 'assistant') {
    const parentId = (message as { parentId?: string }).parentId;
    return {
      ...message,
      id: newMessageId,
      sessionId: newSessionId,
      status: 'completed' as const,
      ...(parentId ? { parentId: idMap.get(parentId) ?? parentId } : {}),
    };
  }
  return {
    ...message,
    id: newMessageId,
    sessionId: newSessionId,
  };
}

function copyPart(part: Part, newMessageId: string, newPartId: string): Part {
  const { id: _oldId, messageId: _oldMsgId, ...rest } = part;
  return {
    ...rest,
    id: newPartId,
    messageId: newMessageId,
  } as Part;
}

export async function forkSession(options: ForkOptions): Promise<ForkResult> {
  const { sessionId, targetMessageId, title } = options;
  const sourceSession = await getSession(sessionId);
  if (!sourceSession) throw new Error('Source session not found');

  const allMessages = await listMessagesWithParts(sessionId);
  const targetIndex = allMessages.findIndex((entry) => entry.message.id === targetMessageId);
  if (targetIndex === -1) throw new Error('Target message not found');

  const messagesToFork = allMessages.slice(0, targetIndex + 1);
  const forkedSession = await createSession({
    id: generateId(),
    workspaceId: sourceSession.workspaceId,
    preconfigId: sourceSession.preconfigId,
    title: title || `${sourceSession.title || 'Untitled'} (fork)`,
    status: 'active',
    metadata: { ...(sourceSession.metadata || {}), forkedFrom: sessionId },
    parentId: null,
    agentName: null,
    selectedModel: sourceSession.selectedModel,
    selectedProvider: sourceSession.selectedProvider,
    promptTokens: sourceSession.promptTokens,
    completionTokens: sourceSession.completionTokens,
    totalTokens: sourceSession.totalTokens,
    autoApproveSeverity: sourceSession.autoApproveSeverity ?? await getWorkspaceAutoApproveSeverity(sourceSession.workspaceId),
  });

  const forkedMessages: MessageWithParts[] = [];
  const idMap = new Map<string, string>();
  for (const { message } of messagesToFork) idMap.set(message.id, generateId());

  for (const { message, parts } of messagesToFork) {
    const newMessageId = idMap.get(message.id)!;
    const newMessage = copyMessage(message, forkedSession.id, newMessageId, idMap);
    await createMessage(newMessage);
    const newParts: Part[] = [];
    for (const part of parts) {
      const newPart = copyPart(part, newMessageId, generateId());
      await createPart(newPart, forkedSession.id);
      newParts.push(newPart);
    }
    forkedMessages.push({ message: newMessage, parts: newParts });
  }

  return { forkedSession, messages: forkedMessages };
}
