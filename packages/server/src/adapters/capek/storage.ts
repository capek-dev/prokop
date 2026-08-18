import {
  configureStorage,
  type StorageBundle,
} from '@capekai/core/storage';
import {
  buildEffectiveContextHistory,
  createMessage,
  createPart,
  deleteMessage,
  getMessage,
  getMessageWithParts,
  getPart,
  getPartsByMessage,
  getPartsBySession,
  listLatestMessagesWithPartsPage,
  listMessagesWithParts,
  persistStreamingPartSnapshots,
  syncMessageFts,
  transitionToolToInterrupted,
  transitionToolToRunningByCallId,
  updateMessage,
  updatePart,
} from '@/infrastructure/sqlite/message-store';
import {
  createSession,
  getChildSessions,
  getSession,
  updateSession,
} from '@/infrastructure/sqlite/session-store';
import {
  addMessageToQueue,
  deleteQueuedMessage,
  getNextQueuedMessage,
} from '@/infrastructure/sqlite/queued-messages';
import { getAttachment } from '@/infrastructure/sqlite/attachments';
import { getResponseFormat } from '@/infrastructure/sqlite/response-formats';
import { getWorkspace, getWorkspaceAutoApproveSeverity } from '@/infrastructure/sqlite/workspaces';
import { jean2ToolOutputArtifactStore } from '@/infrastructure/sqlite/tool-output-artifacts';

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
