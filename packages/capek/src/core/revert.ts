import { deleteMessage, listMessagesWithParts, updateMessage } from '../storage/runtime';

interface RevertResult {
  revertedTo: { messageId: string | null; messageCount: number };
  removed: { messageIds: string[]; partCount: number };
}

interface RevertOptions {
  sessionId: string;
  targetMessageId: string;
  keepTarget?: boolean;
}

export async function revertToStep(options: RevertOptions): Promise<RevertResult> {
  const { sessionId, targetMessageId, keepTarget = false } = options;
  const allMessages = await listMessagesWithParts(sessionId);
  const targetIndex = allMessages.findIndex((entry) => entry.message.id === targetMessageId);
  if (targetIndex === -1) throw new Error('Target message not found');

  const messagesToDelete = targetIndex === 0 && !keepTarget
    ? allMessages
    : allMessages.slice(targetIndex + 1);
  const removedMessageIds: string[] = [];
  let partCountRemoved = 0;

  for (const { message, parts } of messagesToDelete) {
    partCountRemoved += parts.length;
    removedMessageIds.push(message.id);
    await deleteMessage(message.id);
  }

  for (const { message } of await listMessagesWithParts(sessionId)) {
    if (message.role === 'assistant' && message.status === 'streaming') {
      await updateMessage(message.id, { status: 'error', error: 'Reverted before completion' });
    }
  }

  const clearedAll = targetIndex === 0 && !keepTarget;
  return {
    revertedTo: {
      messageId: clearedAll ? null : targetMessageId,
      messageCount: clearedAll ? 0 : targetIndex,
    },
    removed: { messageIds: removedMessageIds, partCount: partCountRemoved },
  };
}
