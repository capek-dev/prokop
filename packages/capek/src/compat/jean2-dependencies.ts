import type { ServerMessage } from '@jean2/sdk';
import { getJean2CompatibilityBindings } from './bindings';
import type { BroadcastFn } from './bindings';

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

export const broadcastEvent = (message: ServerMessage): void => getJean2CompatibilityBindings().delivery.broadcastEvent(message);
export const broadcastSessionCreated = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['delivery']['broadcastSessionCreated']>) =>
  getJean2CompatibilityBindings().delivery.broadcastSessionCreated(...args);
export const broadcastSessionUpdated = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['delivery']['broadcastSessionUpdated']>) =>
  getJean2CompatibilityBindings().delivery.broadcastSessionUpdated(...args);
export const broadcastToSessionEvent = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['delivery']['broadcastToSessionEvent']>) =>
  getJean2CompatibilityBindings().delivery.broadcastToSessionEvent(...args);
export const sendToControllerEvent = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['delivery']['sendToControllerEvent']>) =>
  getJean2CompatibilityBindings().delivery.sendToControllerEvent(...args);
export const sendToAskTargetsEvent = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['delivery']['sendToAskTargetsEvent']>) =>
  getJean2CompatibilityBindings().delivery.sendToAskTargetsEvent(...args);
export const notifyTerminalMessage = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['delivery']['notifyTerminalMessage']>) =>
  getJean2CompatibilityBindings().delivery.notifyTerminalMessage(...args);
export const isDefaultSessionTitle = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['titles']['isDefaultSessionTitle']>) =>
  getJean2CompatibilityBindings().titles.isDefaultSessionTitle(...args);
export const hasManualSessionTitle = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['titles']['hasManualSessionTitle']>) =>
  getJean2CompatibilityBindings().titles.hasManualSessionTitle(...args);
export const generateSessionTitle = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['titles']['generateSessionTitle']>) =>
  getJean2CompatibilityBindings().titles.generateSessionTitle(...args);
export const getToolWorkspaceHost = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['workspace']['createToolWorkspaceHost']>) =>
  getJean2CompatibilityBindings().workspace.createToolWorkspaceHost(...args);
export const isSandboxActive = (): boolean => getJean2CompatibilityBindings().sandbox.isSandboxActive();

export type { BroadcastFn };
