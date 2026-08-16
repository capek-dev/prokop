import {
  configureStorage,
  type StorageBundle,
} from '@capekai/core/storage';
import {
  addMessageToQueue,
  buildEffectiveContextHistory,
  createMessage,
  createPart,
  createSession,
  deleteMessage,
  deleteQueuedMessage,
  getAttachment,
  getChildSessions,
  getMessage,
  getMessageWithParts,
  getNextQueuedMessage,
  getPart,
  getPartsByMessage,
  getPartsBySession,
  getResponseFormat,
  getSession,
  getWorkspace,
  jean2ToolOutputArtifactStore,
  listLatestMessagesWithPartsPage,
  listMessagesWithParts,
  persistStreamingPartSnapshots,
  syncMessageFts,
  transitionToolToInterrupted,
  transitionToolToRunningByCallId,
  updateMessage,
  updatePart,
  updateSession,
} from '@/store';
import { getWorkspaceAutoApproveSeverity } from '@/store/workspaces';

export const jean2StorageBundle: StorageBundle = {
  conversation: {
    createSession,
    createMessage,
    getMessage,
    getMessageWithParts,
    deleteMessage,
    updateMessage: (id, updates) => updateMessage(id, updates, { syncFts: false }),
    getSession,
    updateSession,
    transitionToolToInterrupted,
    getPartsByMessage,
    createPart: (part, sessionId) => createPart(part, sessionId, { syncFts: false }),
    updatePart: (id, updates) => updatePart(id, updates, { syncFts: false }),
    getPart,
    persistStreamingPartSnapshots,
    transitionToolToRunningByCallId,
    getChildSessions,
    listMessagesWithParts,
    listLatestMessagesWithPartsPage,
    getPartsBySession,
    buildEffectiveContextHistory,
  },
  toolOutputArtifacts: jean2ToolOutputArtifactStore,
  queue: {
    addMessage: addMessageToQueue,
    delete: deleteQueuedMessage,
    peek: getNextQueuedMessage,
  },
  attachments: { get: getAttachment },
  workspaces: {
    get: getWorkspace,
    getAutoApproveSeverity: getWorkspaceAutoApproveSeverity,
  },
  responseFormats: { get: getResponseFormat },
  index: { syncMessage: syncMessageFts },
};

export function configureJean2Storage(): void {
  configureStorage(jean2StorageBundle);
}
