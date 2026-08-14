import type { ServerMessage } from '@jean2/sdk';
import { getRuntimeHost } from './host';
import type { BroadcastFn } from './host';

export {
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
  getWorkspaceAutoApproveSeverity,
  listLatestMessagesWithPartsPage,
  listMessagesWithParts,
  persistStreamingPartSnapshots,
  syncMessageFts,
  transitionToolToInterrupted,
  transitionToolToRunningByCallId,
  updateMessage,
  updatePart,
  updateSession,
} from '../storage/runtime';

export const broadcastEvent = (message: ServerMessage): void => getRuntimeHost().delivery.broadcastEvent(message);
export const broadcastSessionCreated = (...args: Parameters<ReturnType<typeof getRuntimeHost>['delivery']['broadcastSessionCreated']>) =>
  getRuntimeHost().delivery.broadcastSessionCreated(...args);
export const broadcastSessionUpdated = (...args: Parameters<ReturnType<typeof getRuntimeHost>['delivery']['broadcastSessionUpdated']>) =>
  getRuntimeHost().delivery.broadcastSessionUpdated(...args);
export const broadcastToSessionEvent = (...args: Parameters<ReturnType<typeof getRuntimeHost>['delivery']['broadcastToSessionEvent']>) =>
  getRuntimeHost().delivery.broadcastToSessionEvent(...args);
export const sendToControllerEvent = (...args: Parameters<ReturnType<typeof getRuntimeHost>['delivery']['sendToControllerEvent']>) =>
  getRuntimeHost().delivery.sendToControllerEvent(...args);
export const sendToAskTargetsEvent = (...args: Parameters<ReturnType<typeof getRuntimeHost>['delivery']['sendToAskTargetsEvent']>) =>
  getRuntimeHost().delivery.sendToAskTargetsEvent(...args);
export const notifyTerminalMessage = (...args: Parameters<ReturnType<typeof getRuntimeHost>['delivery']['notifyTerminalMessage']>) =>
  getRuntimeHost().delivery.notifyTerminalMessage(...args);
export const isDefaultSessionTitle = (...args: Parameters<ReturnType<typeof getRuntimeHost>['titles']['isDefaultSessionTitle']>) =>
  getRuntimeHost().titles.isDefaultSessionTitle(...args);
export const hasManualSessionTitle = (...args: Parameters<ReturnType<typeof getRuntimeHost>['titles']['hasManualSessionTitle']>) =>
  getRuntimeHost().titles.hasManualSessionTitle(...args);
export const generateSessionTitle = (...args: Parameters<ReturnType<typeof getRuntimeHost>['titles']['generateSessionTitle']>) =>
  getRuntimeHost().titles.generateSessionTitle(...args);
export const getToolWorkspaceHost = (...args: Parameters<ReturnType<typeof getRuntimeHost>['workspace']['createToolWorkspaceHost']>) =>
  getRuntimeHost().workspace.createToolWorkspaceHost(...args);
export const isSandboxActive = (): boolean => getRuntimeHost().sandbox.isSandboxActive();

export type { BroadcastFn };
