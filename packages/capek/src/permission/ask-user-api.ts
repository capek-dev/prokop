/**
 * C6 generic ask surface over the NON-REPLACEABLE permission runtime.
 * These exports preserve the exact pre-C6 `tools/ask-user-api.ts`
 * identities; the state and decisions resolve through
 * `getPermissionRuntimeService()`, so a composed agent scope owns its
 * pending asks and timers while unscoped consumers keep the process-default
 * behavior.
 */

import type { AskApi } from '@capekai/tool'
import type { AskAuthority } from '@capekai/types';
import type { PendingAskRecord } from '../runtime/host';
import { ASK_TIMEOUT } from './policy';
import { getPermissionRuntimeService } from './runtime';
import type { AskBroadcastFn } from './contracts';

export { ASK_TIMEOUT };
export type { AskBroadcastFn };

export function createAskApi(
  sessionId: string,
  toolCallId: string,
  toolName: string,
  broadcastFn: AskBroadcastFn,
  workspaceId?: string,
  rootSessionId?: string,
): AskApi {
  return getPermissionRuntimeService().createAskApi(
    sessionId,
    toolCallId,
    toolName,
    broadcastFn,
    workspaceId,
    rootSessionId,
  );
}

export async function resolveAsk(toolCallId: string, response: unknown, requestId?: string): Promise<boolean> {
  return getPermissionRuntimeService().resolveAsk(toolCallId, response, requestId);
}

export async function rejectAsk(toolCallId: string, error: Error): Promise<boolean> {
  return getPermissionRuntimeService().rejectAsk(toolCallId, error);
}

export async function rejectPendingAsksByToolCallId(toolCallId: string, error?: Error): Promise<string[]> {
  return getPermissionRuntimeService().rejectPendingAsksByToolCallId(toolCallId, error);
}

export async function rejectPendingAsksBySession(sessionId: string, error?: Error): Promise<string[]> {
  return getPermissionRuntimeService().rejectPendingAsksBySession(sessionId, error);
}

export function hasPendingAsk(toolCallId: string): boolean {
  return getPermissionRuntimeService().hasPendingAsk(toolCallId);
}

export function getAuthorityForPendingAsk(toolCallId: string): AskAuthority | undefined {
  return getPermissionRuntimeService().getAuthorityForPendingAsk(toolCallId);
}

export async function getSessionIdForPendingAsk(toolCallId: string, requestId?: string): Promise<string | null> {
  return getPermissionRuntimeService().getSessionIdForPendingAsk(toolCallId, requestId);
}

export const listPendingAsksBySession = (sessionId: string): Promise<PendingAskRecord[]> =>
  getPermissionRuntimeService().listPendingAsksBySession(sessionId);

export const listPendingAsksByRootSession = (rootSessionId: string): Promise<PendingAskRecord[]> =>
  getPermissionRuntimeService().listPendingAsksByRootSession(rootSessionId);
