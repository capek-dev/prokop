import type { StorageBundle } from './contracts';
import { createInMemoryStorageBundle } from './memory';

let storage: StorageBundle = createInMemoryStorageBundle();

export function configureStorage(value: StorageBundle): void {
  storage = value;
}

export function getStorage(): StorageBundle {
  return storage;
}

export const createSession = (...args: Parameters<StorageBundle['conversation']['createSession']>) =>
  storage.conversation.createSession(...args);
export const getSession = (...args: Parameters<StorageBundle['conversation']['getSession']>) =>
  storage.conversation.getSession(...args);
export const updateSession = (...args: Parameters<StorageBundle['conversation']['updateSession']>) =>
  storage.conversation.updateSession(...args);
export const getChildSessions = (...args: Parameters<StorageBundle['conversation']['getChildSessions']>) =>
  storage.conversation.getChildSessions(...args);
export const createMessage = (...args: Parameters<StorageBundle['conversation']['createMessage']>) =>
  storage.conversation.createMessage(...args);
export const getMessage = (...args: Parameters<StorageBundle['conversation']['getMessage']>) =>
  storage.conversation.getMessage(...args);
export const getMessageWithParts = (...args: Parameters<StorageBundle['conversation']['getMessageWithParts']>) =>
  storage.conversation.getMessageWithParts(...args);
export function updateMessage(
  id: string,
  updates: Parameters<StorageBundle['conversation']['updateMessage']>[1],
  options?: { syncFts?: boolean },
) {
  const result = storage.conversation.updateMessage(id, updates);
  if (result && options?.syncFts !== false) storage.index.syncMessage(id);
  return result;
}
export const deleteMessage = (...args: Parameters<StorageBundle['conversation']['deleteMessage']>) => {
  storage.index.removeMessage?.(args[0]);
  return storage.conversation.deleteMessage(...args);
};
export const listMessagesWithParts = (...args: Parameters<StorageBundle['conversation']['listMessagesWithParts']>) =>
  storage.conversation.listMessagesWithParts(...args);
export const listLatestMessagesWithPartsPage = (...args: Parameters<StorageBundle['conversation']['listLatestMessagesWithPartsPage']>) =>
  storage.conversation.listLatestMessagesWithPartsPage(...args);
export const buildEffectiveContextHistory = (...args: Parameters<StorageBundle['conversation']['buildEffectiveContextHistory']>) =>
  storage.conversation.buildEffectiveContextHistory(...args);
export function createPart(
  part: Parameters<StorageBundle['conversation']['createPart']>[0],
  sessionId: string,
  options?: { syncFts?: boolean },
) {
  const result = storage.conversation.createPart(part, sessionId);
  if (options?.syncFts !== false && (part.type === 'text' || part.type === 'tool')) {
    storage.index.syncMessage(part.messageId);
  }
  return result;
}
export const getPart = (...args: Parameters<StorageBundle['conversation']['getPart']>) =>
  storage.conversation.getPart(...args);
export const getPartsByMessage = (...args: Parameters<StorageBundle['conversation']['getPartsByMessage']>) =>
  storage.conversation.getPartsByMessage(...args);
export const getPartsBySession = (...args: Parameters<StorageBundle['conversation']['getPartsBySession']>) =>
  storage.conversation.getPartsBySession(...args);
export function updatePart(
  id: string,
  updates: Record<string, unknown>,
  options?: { syncFts?: boolean },
) {
  const previous = storage.conversation.getPart(id);
  const result = storage.conversation.updatePart(id, updates);
  if (result && options?.syncFts !== false
    && (previous?.type === 'text' || previous?.type === 'tool' || result.type === 'text' || result.type === 'tool')) {
    storage.index.syncMessage(result.messageId);
  }
  return result;
}
export const persistStreamingPartSnapshots = (...args: Parameters<StorageBundle['conversation']['persistStreamingPartSnapshots']>) =>
  storage.conversation.persistStreamingPartSnapshots(...args);
export const transitionToolToRunningByCallId = (...args: Parameters<StorageBundle['conversation']['transitionToolToRunningByCallId']>) =>
  storage.conversation.transitionToolToRunningByCallId(...args);
export const transitionToolToInterrupted = (...args: Parameters<StorageBundle['conversation']['transitionToolToInterrupted']>) =>
  storage.conversation.transitionToolToInterrupted(...args);
export const syncMessageFts = (messageId: string): void => storage.index.syncMessage(messageId);
export const addMessageToQueue = (...args: Parameters<StorageBundle['queue']['addMessage']>) =>
  storage.queue.addMessage(...args);
export const getNextQueuedMessage = (...args: Parameters<StorageBundle['queue']['peek']>) =>
  storage.queue.peek(...args);
export const deleteQueuedMessage = (...args: Parameters<StorageBundle['queue']['delete']>) =>
  storage.queue.delete(...args);
export const getAttachment = (...args: Parameters<StorageBundle['attachments']['get']>) =>
  storage.attachments.get(...args);
export const getWorkspace = (...args: Parameters<StorageBundle['workspaces']['get']>) =>
  storage.workspaces.get(...args);
export const getWorkspaceAutoApproveSeverity = (...args: Parameters<StorageBundle['workspaces']['getAutoApproveSeverity']>) =>
  storage.workspaces.getAutoApproveSeverity(...args);
export const getResponseFormat = (...args: Parameters<StorageBundle['responseFormats']['get']>) =>
  storage.responseFormats.get(...args);
