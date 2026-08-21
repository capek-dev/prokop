import type { Ask, AskAuthority, AskResponse } from '@prokopai/sdk';
import type { SessionHandlersContext } from './types';
import type { PendingAskRequest } from '@/stores/askStore';

export function handleAskRequest(
  msg: { type: 'ask.request'; sessionId: string; toolCallId: string; toolName: string; ask: Ask; requestId?: string; authority?: AskAuthority },
  ctx: SessionHandlersContext,
): void {
  const { sessionId, toolCallId, toolName, ask, requestId } = msg;
  const { addPendingAskRequest, runAskHandlers, sendAskResponse } = ctx;

  const request: PendingAskRequest = {
    toolCallId,
    sessionId,
    toolName,
    ask,
    originSessionId: (ask as { _originSessionId?: string })._originSessionId,
    requestId,
  };

  // Derive target from ask type (PermissionAsk has implicit 'permission' target)
  const target = ask.type === 'permission' ? 'permission' 
    : ask.type === 'client_capability' ? 'client' 
    : 'human';

  // Play permission sound when the request will be shown to the user.
  // Uses canonical dedup key (requestId for permission asks, toolCallId as fallback)
  // to ensure the sound plays only once per unique permission, even when the same
  // permission surfaces across a subagent session tree.
  const maybePlayPermissionSound = () => {
    if (ask.type !== 'permission') return;
    const {
      sessionsRef,
      notifiedToolCallIdsRef,
      permissionSoundEnabledRef,
      playPermissionSound,
    } = ctx;
    const dedupKey = requestId ?? toolCallId;
    const session = sessionsRef.current.find(s => s.id === sessionId);
    if (session?.parentId === null && permissionSoundEnabledRef.current && !notifiedToolCallIdsRef.current.has(dedupKey)) {
      playPermissionSound();
      notifiedToolCallIdsRef.current.add(dedupKey);
    }
  };

  // Try programmatic handlers first
  const handlers = runAskHandlers(target, request);
  if (handlers) {
    handlers
      .then((result) => {
        if (result !== undefined) {
          sendAskResponse(toolCallId, result, requestId);
        } else {
          // No handler resolved it — show to user
          addPendingAskRequest(request);
          maybePlayPermissionSound();
        }
      })
      .catch(() => {
        // Handler errored — show to user
        addPendingAskRequest(request);
        maybePlayPermissionSound();
      });
  } else {
    // No handlers registered for this target — show to user
    addPendingAskRequest(request);
    maybePlayPermissionSound();
  }
}

export function handleAskTimeout(
  msg: { type: 'ask.timeout'; sessionId: string; toolCallId: string; requestId?: string },
  ctx: SessionHandlersContext,
): void {
  const { requestId, toolCallId } = msg;
  const { removePendingAskRequest, removePendingPermissionRequest } = ctx;
  // For permission asks, use requestId as canonical identity
  if (requestId) {
    removePendingPermissionRequest(requestId, toolCallId);
  } else {
    removePendingAskRequest(toolCallId);
  }
}

export function handleAskPendingSync(
  msg: {
    type: 'ask.pending_sync';
    sessionId: string;
    requests: Array<{
      sessionId: string;
      toolCallId: string;
      toolName: string;
      ask: Ask;
      requestId?: string;
      _originSessionId?: string;
      authority?: AskAuthority;
    }>;
  },
  ctx: SessionHandlersContext,
): void {
  const { replacePendingPermissionRequests, runAskHandlers, sendAskResponse, addPendingAskRequest } = ctx;

  // Convert server requests to PendingAskRequest format
  const requests: PendingAskRequest[] = msg.requests.map((r) => ({
    toolCallId: r.toolCallId,
    sessionId: r.sessionId,
    toolName: r.toolName,
    ask: r.ask,
    originSessionId: r._originSessionId,
    requestId: r.requestId,
  }));

  // Run auto-approve handlers on permission asks before showing them in the UI.
  // Without this, switching back to a session with auto-approve configured would
  // re-prompt for permissions that should have been auto-approved.
  const autoApprovePromises: Array<{ request: PendingAskRequest; promise: Promise<AskResponse | undefined> }> = [];
  const toShowInUI: PendingAskRequest[] = [];

  for (const request of requests) {
    if (request.ask.type === 'permission') {
      const result = runAskHandlers('permission', request);
      if (result !== undefined) {
        autoApprovePromises.push({ request, promise: result });
      } else {
        toShowInUI.push(request);
      }
    } else {
      toShowInUI.push(request);
    }
  }

  // Immediately show only the requests that need user input.
  // Atomically replace stale local entries with the filtered set.
  replacePendingPermissionRequests(toShowInUI);

  // Process auto-approve results asynchronously.
  // If a handler resolves with a value, send the response to the server.
  // If it resolves without a value or errors, fall back to showing in UI.
  for (const { request, promise } of autoApprovePromises) {
    promise
      .then((result) => {
        if (result !== undefined) {
          sendAskResponse(request.toolCallId, result, request.requestId);
        } else {
          addPendingAskRequest(request);
        }
      })
      .catch(() => {
        addPendingAskRequest(request);
      });
  }
}

export function handleAskResponseRejected(
  msg: {
    type: 'ask.response_rejected';
    sessionId: string;
    toolCallId: string;
    requestId?: string;
    code: string;
    message: string;
  },
  _ctx: SessionHandlersContext,
): void {
  console.warn(`Ask response rejected: [${msg.code}] ${msg.message} (sessionId=${msg.sessionId}, toolCallId=${msg.toolCallId})`);
}

export const askHandlers = {
  'ask.request': handleAskRequest,
  'ask.timeout': handleAskTimeout,
  'ask.pending_sync': handleAskPendingSync,
  'ask.response_rejected': handleAskResponseRejected,
} as const;