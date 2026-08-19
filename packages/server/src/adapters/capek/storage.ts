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
    createSession: async (...args) => createSession(...args),
    createMessage: async (...args) => createMessage(...args),
    getMessage: async (...args) => getMessage(...args),
    getMessageWithParts: async (...args) => getMessageWithParts(...args),
    deleteMessage: async (...args) => deleteMessage(...args),
    updateMessage: async (id, updates) => updateMessage(id, updates, { syncFts: false }),
    getSession: async (...args) => getSession(...args),
    updateSession: async (...args) => updateSession(...args),
    transitionToolToInterrupted: async (...args) => transitionToolToInterrupted(...args),
    getPartsByMessage: async (...args) => getPartsByMessage(...args),
    createPart: async (part, sessionId) => createPart(part, sessionId, { syncFts: false }),
    updatePart: async (id, updates) => updatePart(id, updates, { syncFts: false }),
    getPart: async (...args) => getPart(...args),
    persistStreamingPartSnapshots: async (...args) => persistStreamingPartSnapshots(...args),
    transitionToolToRunningByCallId: async (...args) => transitionToolToRunningByCallId(...args),
    getChildSessions: async (...args) => getChildSessions(...args),
    listMessagesWithParts: async (...args) => listMessagesWithParts(...args),
    listLatestMessagesWithPartsPage: async (...args) => listLatestMessagesWithPartsPage(...args),
    getPartsBySession: async (...args) => getPartsBySession(...args),
    buildEffectiveContextHistory: async (...args) => buildEffectiveContextHistory(...args),
  },
  toolOutputArtifacts: jean2ToolOutputArtifactStore,
  queue: {
    addMessage: async (...args) => addMessageToQueue(...args),
    delete: async (...args) => deleteQueuedMessage(...args),
    peek: async (...args) => getNextQueuedMessage(...args),
  },
  attachments: { get: async (...args) => getAttachment(...args) },
  workspaces: {
    get: async (...args) => getWorkspace(...args),
    getAutoApproveSeverity: async (...args) => getWorkspaceAutoApproveSeverity(...args),
  },
  responseFormats: { get: async (...args) => getResponseFormat(...args) },
  index: { syncMessage: async (...args) => syncMessageFts(...args) },
};

export function configureJean2Storage(): void {
  configureStorage(jean2StorageBundle);
}
