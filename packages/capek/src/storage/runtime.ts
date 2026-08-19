import { AsyncLocalStorage } from 'node:async_hooks';
import type { StorageBundle } from './contracts';
import { createInMemoryStorageBundle } from './memory';

let storage: StorageBundle = createInMemoryStorageBundle();
const scopedStorage = new AsyncLocalStorage<StorageBundle>();

function activeStorage(): StorageBundle {
  return scopedStorage.getStore() ?? storage;
}

export function withStorage<T>(value: StorageBundle, callback: () => T): T {
  return scopedStorage.run(value, callback);
}

export function configureStorage(value: StorageBundle): void {
  storage = value;
}

export function getStorage(): StorageBundle {
  return activeStorage();
}

export const createSession = async (...args: Parameters<StorageBundle['conversation']['createSession']>) =>
  activeStorage().conversation.createSession(...args);
export const getSession = async (...args: Parameters<StorageBundle['conversation']['getSession']>) =>
  activeStorage().conversation.getSession(...args);
export const updateSession = async (...args: Parameters<StorageBundle['conversation']['updateSession']>) =>
  activeStorage().conversation.updateSession(...args);
export const getChildSessions = async (...args: Parameters<StorageBundle['conversation']['getChildSessions']>) =>
  activeStorage().conversation.getChildSessions(...args);
export const createMessage = async (...args: Parameters<StorageBundle['conversation']['createMessage']>) =>
  activeStorage().conversation.createMessage(...args);
export const getMessage = async (...args: Parameters<StorageBundle['conversation']['getMessage']>) =>
  activeStorage().conversation.getMessage(...args);
export const getMessageWithParts = async (...args: Parameters<StorageBundle['conversation']['getMessageWithParts']>) =>
  activeStorage().conversation.getMessageWithParts(...args);
export async function updateMessage(
  id: string,
  updates: Parameters<StorageBundle['conversation']['updateMessage']>[1],
  options?: { syncFts?: boolean },
) {
  const current = activeStorage();
  const result = await current.conversation.updateMessage(id, updates);
  if (result && options?.syncFts !== false) await current.index.syncMessage(id);
  return result;
}
export const deleteMessage = async (...args: Parameters<StorageBundle['conversation']['deleteMessage']>) => {
  const current = activeStorage();
  await current.index.removeMessage?.(args[0]);
  return current.conversation.deleteMessage(...args);
};
export const listMessagesWithParts = async (...args: Parameters<StorageBundle['conversation']['listMessagesWithParts']>) =>
  activeStorage().conversation.listMessagesWithParts(...args);
export const listLatestMessagesWithPartsPage = async (...args: Parameters<StorageBundle['conversation']['listLatestMessagesWithPartsPage']>) =>
  activeStorage().conversation.listLatestMessagesWithPartsPage(...args);
export const buildEffectiveContextHistory = async (...args: Parameters<StorageBundle['conversation']['buildEffectiveContextHistory']>) =>
  activeStorage().conversation.buildEffectiveContextHistory(...args);
export async function createPart(
  part: Parameters<StorageBundle['conversation']['createPart']>[0],
  sessionId: string,
  options?: { syncFts?: boolean },
) {
  const current = activeStorage();
  const result = await current.conversation.createPart(part, sessionId);
  if (result && options?.syncFts !== false && (part.type === 'text' || part.type === 'tool')) {
    await current.index.syncMessage(part.messageId);
  }
  return result;
}
export const getPart = async (...args: Parameters<StorageBundle['conversation']['getPart']>) =>
  activeStorage().conversation.getPart(...args);
export const getPartsByMessage = async (...args: Parameters<StorageBundle['conversation']['getPartsByMessage']>) =>
  activeStorage().conversation.getPartsByMessage(...args);
export const getPartsBySession = async (...args: Parameters<StorageBundle['conversation']['getPartsBySession']>) =>
  activeStorage().conversation.getPartsBySession(...args);
export async function updatePart(
  id: string,
  updates: Record<string, unknown>,
  options?: { syncFts?: boolean },
) {
  const current = activeStorage();
  const previous = await current.conversation.getPart(id);
  const result = await current.conversation.updatePart(id, updates);
  if (result && options?.syncFts !== false
    && (previous?.type === 'text' || previous?.type === 'tool' || result.type === 'text' || result.type === 'tool')) {
    await current.index.syncMessage(result.messageId);
  }
  return result;
}
export const persistStreamingPartSnapshots = async (...args: Parameters<StorageBundle['conversation']['persistStreamingPartSnapshots']>) =>
  activeStorage().conversation.persistStreamingPartSnapshots(...args);
export const transitionToolToRunningByCallId = async (...args: Parameters<StorageBundle['conversation']['transitionToolToRunningByCallId']>) =>
  activeStorage().conversation.transitionToolToRunningByCallId(...args);
export const transitionToolToInterrupted = async (...args: Parameters<StorageBundle['conversation']['transitionToolToInterrupted']>) =>
  activeStorage().conversation.transitionToolToInterrupted(...args);
export const syncMessageFts = async (messageId: string): Promise<void> => activeStorage().index.syncMessage(messageId);
export const createToolOutputArtifact = (...args: Parameters<StorageBundle['toolOutputArtifacts']['create']>) =>
  activeStorage().toolOutputArtifacts.create(...args);
export const getToolOutputArtifactPage = (...args: Parameters<StorageBundle['toolOutputArtifacts']['getPage']>) =>
  activeStorage().toolOutputArtifacts.getPage(...args);
export const addMessageToQueue = (...args: Parameters<StorageBundle['queue']['addMessage']>) =>
  activeStorage().queue.addMessage(...args);
export const getNextQueuedMessage = (...args: Parameters<StorageBundle['queue']['peek']>) =>
  activeStorage().queue.peek(...args);
export const deleteQueuedMessage = (...args: Parameters<StorageBundle['queue']['delete']>) =>
  activeStorage().queue.delete(...args);
export const getAttachment = (...args: Parameters<StorageBundle['attachments']['get']>) =>
  activeStorage().attachments.get(...args);
export const getWorkspace = async (...args: Parameters<StorageBundle['workspaces']['get']>) =>
  activeStorage().workspaces.get(...args);
export const getWorkspaceAutoApproveSeverity = async (...args: Parameters<StorageBundle['workspaces']['getAutoApproveSeverity']>) =>
  activeStorage().workspaces.getAutoApproveSeverity(...args);
export const getResponseFormat = (...args: Parameters<StorageBundle['responseFormats']['get']>) =>
  activeStorage().responseFormats.get(...args);
