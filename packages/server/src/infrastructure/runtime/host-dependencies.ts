import type { Session } from '@prokopai/sdk/types';
import type { ToolDefinition } from '@prokopai/sdk/tool';
import { getOptionalRuntimeHost, getRuntimeHost } from '@/infrastructure/runtime/host';
import type { RuntimeAudience, RuntimeDelivery, RuntimeEvent } from '@/infrastructure/runtime/events';

type HostRuntimeAudience = Exclude<RuntimeAudience, { scope: 'origin' }>;

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
} from '@/infrastructure/storage/runtime';

export function emitRuntimeEvent(event: RuntimeEvent, audience: HostRuntimeAudience = { scope: 'global' }): void {
  const delivery: RuntimeDelivery = { event, audience };
  const host = getRuntimeHost().delivery;
  host.observe?.(delivery);
  host.emit(delivery);
}

export const emitSessionCreated = (session: Session): void =>
  emitRuntimeEvent({ kind: 'session', action: 'created', session });
export const emitSessionUpdated = (session: Session): void =>
  emitRuntimeEvent({ kind: 'session', action: 'updated', session });
export const emitToSession = (sessionId: string, event: RuntimeEvent): void =>
  emitRuntimeEvent(event, { scope: 'session', sessionId });
export const emitToController = (sessionId: string, event: RuntimeEvent): void =>
  emitRuntimeEvent(event, { scope: 'controller', sessionId });
export const emitToAskTargets = (
  sessionId: string,
  authority: Extract<RuntimeAudience, { scope: 'ask_targets' }>['authority'],
  event: RuntimeEvent,
): void => emitRuntimeEvent(event, { scope: 'ask_targets', sessionId, authority });
export const emitTerminal = (message: Extract<RuntimeEvent, { kind: 'terminal' }>['message'], sessionId: string): void =>
  emitRuntimeEvent({ kind: 'terminal', message, sessionId }, { scope: 'host' });

export const isDefaultSessionTitle = (...args: Parameters<ReturnType<typeof getRuntimeHost>['titles']['isDefaultSessionTitle']>) =>
  getRuntimeHost().titles.isDefaultSessionTitle(...args);
export const hasManualSessionTitle = (...args: Parameters<ReturnType<typeof getRuntimeHost>['titles']['hasManualSessionTitle']>) =>
  getRuntimeHost().titles.hasManualSessionTitle(...args);
export const generateSessionTitle = (...args: Parameters<ReturnType<typeof getRuntimeHost>['titles']['generateSessionTitle']>) =>
  getRuntimeHost().titles.generateSessionTitle(...args);
export const getToolWorkspaceHost = (...args: Parameters<ReturnType<typeof getRuntimeHost>['workspace']['createToolWorkspaceHost']>) =>
  getRuntimeHost().workspace.createToolWorkspaceHost(...args);

export async function resolveSessionWorkspace(options: {
  sessionId: string;
  workspaceId?: string;
  workspaceRootId?: string;
  workspacePath?: string;
  additionalPaths?: string[];
}): Promise<{ workspacePath?: string; additionalPaths?: string[] }> {
  const resolver = getRuntimeHost().workspace.resolveSessionWorkspace;
  if (resolver) {
    return await resolver(options);
  }
  if (options.workspaceRootId) {
    throw new Error('Session workspace root requires a host resolver');
  }
  return {
    workspacePath: options.workspacePath,
    additionalPaths: options.additionalPaths,
  };
}

export async function resolveToolDefinition(options: {
  sessionId: string;
  workspaceId?: string;
  workspaceRootId?: string;
  workspacePath?: string;
  definition: ToolDefinition;
}): Promise<ToolDefinition | null> {
  const resolver = getOptionalRuntimeHost()?.toolPolicy?.resolveDefinition;
  return resolver ? await resolver(options) : options.definition;
}

export const isSandboxActive = (): boolean => getRuntimeHost().sandbox.isSandboxActive();

export type { RuntimeEventSink, RuntimeEventSink as BroadcastFn } from '@/infrastructure/runtime/events';
