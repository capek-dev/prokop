import type {
  Ask,
  AskApi,
  AskAuthority,
  AskRequestMessage,
  AskTimedOutMessage,
  ClientCapability,
} from '@jean2/sdk';
import { getJean2CompatibilityBindings } from '../compat/bindings';
import {
  rejectPermissionsBySession,
  rejectPermissionsByToolCallId,
  requestPermission,
  resolvePermission,
} from './permission-request-manager';

interface PendingAsk {
  resolve: (response: unknown) => void;
  reject: (error: Error) => void;
  ask: Ask;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  broadcastFn: AskBroadcastFn;
  authority: AskAuthority;
}

const pendingAsks = new Map<string, PendingAsk>();
const askTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const ASK_TIMEOUT = 5 * 60 * 1000;

const DEFAULT_ASK_AUTHORITY: AskAuthority = {
  visibilityScope: 'controller_only',
  resolutionMode: 'controller_only',
};

export type AskBroadcastFn = (message: AskRequestMessage | AskTimedOutMessage) => void;

function interaction() {
  return getJean2CompatibilityBindings().interaction;
}

function resolveAuthorityForAsk(request: Ask): AskAuthority {
  if (
    request.type === 'client_capability' &&
    'target' in request &&
    request.target === 'client'
  ) {
    return {
      visibilityScope: 'global',
      resolutionMode: 'first_eligible',
      requiredCapabilities: [request.capability as ClientCapability],
    };
  }
  return DEFAULT_ASK_AUTHORITY;
}

export function createAskApi(
  sessionId: string,
  toolCallId: string,
  toolName: string,
  broadcastFn: AskBroadcastFn,
  workspaceId?: string,
  rootSessionId?: string,
): AskApi {
  let askCounter = 0;

  const ask = async (request: Ask): Promise<unknown> => {
    if (request.type === 'permission') {
      return requestPermission({
        sessionId,
        rootSessionId,
        toolCallId,
        toolName,
        ask: request,
        broadcastFn,
        workspaceId,
        timeoutMs: ASK_TIMEOUT,
      });
    }

    const askId = `${toolCallId}#${++askCounter}`;
    const authority = resolveAuthorityForAsk(request);

    return new Promise<unknown>((resolve, reject) => {
      broadcastFn({
        type: 'ask.request',
        sessionId,
        toolCallId,
        toolName,
        ask: request,
        authority,
      });

      pendingAsks.set(askId, {
        resolve,
        reject,
        ask: request,
        sessionId,
        toolCallId,
        toolName,
        broadcastFn,
        authority,
      });

      interaction().createPendingAsk({
        sessionId,
        toolCallId,
        toolName,
        ask: request,
        createdAt: Date.now(),
        requestId: askId,
        status: 'pending',
        isPermission: false,
        workspaceId,
      });

      const timerId = setTimeout(() => {
        if (!pendingAsks.has(askId)) return;
        pendingAsks.delete(askId);
        askTimers.delete(askId);
        removePendingAskRecord(askId);
        broadcastFn({
          type: 'ask.timeout',
          sessionId,
          toolCallId,
        });
        reject(new Error('User did not respond in time'));
      }, ASK_TIMEOUT);
      askTimers.set(askId, timerId);
    });
  };

  return ask as AskApi;
}

function extractResolutionValue(response: unknown): unknown {
  if (!response || typeof response !== 'object') return response;
  const record = response as Record<string, unknown>;

  switch (record.type) {
    case 'single_select':
      return record.value;
    case 'multi_select':
      return record.values;
    case 'text':
      return record.value;
    case 'confirm':
      return record.confirmed;
    case 'form':
      return response;
    case 'client_capability':
      return record.result;
    default:
      return response;
  }
}

export function resolveAsk(toolCallId: string, response: unknown, requestId?: string): boolean {
  if (requestId) {
    const pending = pendingAsks.get(requestId);
    if (pending) return resolvePendingAsk(requestId, pending, response);
    return resolvePermission(requestId, response);
  }

  const exact = pendingAsks.get(toolCallId);
  if (exact) return resolvePendingAsk(toolCallId, exact, response);

  for (const [key, pending] of pendingAsks) {
    if (key === toolCallId || key.startsWith(`${toolCallId}#`)) {
      return resolvePendingAsk(key, pending, response);
    }
  }
  return false;
}

function resolvePendingAsk(key: string, pending: PendingAsk, response: unknown): boolean {
  clearAskTimer(key);
  pending.resolve(extractResolutionValue(response));
  pendingAsks.delete(key);
  removePendingAskRecord(key);
  return true;
}

export function rejectAsk(toolCallId: string, error: Error): boolean {
  const exact = pendingAsks.get(toolCallId);
  if (exact) return rejectPendingAsk(toolCallId, exact, error);

  for (const [key, pending] of pendingAsks) {
    if (key === toolCallId || key.startsWith(`${toolCallId}#`)) {
      return rejectPendingAsk(key, pending, error);
    }
  }
  return false;
}

function rejectPendingAsk(key: string, pending: PendingAsk, error: Error): boolean {
  clearAskTimer(key);
  pending.reject(error);
  pendingAsks.delete(key);
  removePendingAskRecord(key);
  return true;
}

export function rejectPendingAsksByToolCallId(toolCallId: string, error?: Error): string[] {
  const rejectedIds = rejectPermissionsByToolCallId(toolCallId, error);
  const timeoutError = error ?? new Error('Tool execution ended');

  for (const [askId, pending] of pendingAsks) {
    if (
      pending.toolCallId !== toolCallId &&
      askId !== toolCallId &&
      !askId.startsWith(`${toolCallId}#`)
    ) {
      continue;
    }
    clearAskTimer(askId);
    pending.broadcastFn({
      type: 'ask.timeout',
      sessionId: pending.sessionId,
      toolCallId: pending.toolCallId,
    });
    pending.reject(timeoutError);
    pendingAsks.delete(askId);
    removePendingAskRecord(askId);
    rejectedIds.push(askId);
  }
  return rejectedIds;
}

export function rejectPendingAsksBySession(sessionId: string, error?: Error): string[] {
  const rejectedIds = rejectPermissionsBySession(sessionId, error);
  const interruptError = error ?? new Error('Session interrupted');

  for (const [askId, pending] of pendingAsks) {
    if (pending.sessionId !== sessionId) continue;
    clearAskTimer(askId);
    pending.reject(interruptError);
    pendingAsks.delete(askId);
    removePendingAskRecord(askId);
    rejectedIds.push(askId);
  }
  return rejectedIds;
}

export function hasPendingAsk(toolCallId: string): boolean {
  if (pendingAsks.has(toolCallId)) return true;
  for (const key of pendingAsks.keys()) {
    if (key.startsWith(`${toolCallId}#`)) return true;
  }
  return false;
}

export function getAuthorityForPendingAsk(toolCallId: string): AskAuthority | undefined {
  const exact = pendingAsks.get(toolCallId);
  if (exact) return exact.authority;
  for (const [key, pending] of pendingAsks) {
    if (key === toolCallId || key.startsWith(`${toolCallId}#`)) return pending.authority;
  }
  return undefined;
}

export function getSessionIdForPendingAsk(toolCallId: string, requestId?: string): string | null {
  if (requestId) {
    const record = interaction().getPermissionRequestByRequestId(requestId);
    if (record) return record.sessionId;
  }

  const exact = pendingAsks.get(toolCallId);
  if (exact) return exact.sessionId;
  for (const [key, pending] of pendingAsks) {
    if (key === toolCallId || key.startsWith(`${toolCallId}#`)) return pending.sessionId;
  }

  if (!requestId) {
    const record = interaction().getPermissionRequestByRequestId(toolCallId);
    if (record) return record.sessionId;
  }
  return null;
}

function removePendingAskRecord(requestId: string): void {
  const record = interaction().getPermissionRequestByRequestId(requestId);
  if (record) interaction().removePendingAsk(record.id);
}

function clearAskTimer(askId: string): void {
  const timer = askTimers.get(askId);
  if (!timer) return;
  clearTimeout(timer);
  askTimers.delete(askId);
}

export const listPendingAsksBySession = (sessionId: string) =>
  interaction().listPendingAsksBySession(sessionId);
export const listPendingAsksByRootSession = (rootSessionId: string) =>
  interaction().listPendingAsksByRootSession(rootSessionId);
