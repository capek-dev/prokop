import { create } from 'zustand';
import type { Ask, AskTarget, AskResponse } from '@prokopai/sdk';

export interface PendingAskRequest {
  toolCallId: string;
  sessionId: string;
  toolName: string;
  ask: Ask;
  originSessionId?: string;
  /** Canonical request identity for permission asks (correlates with server DB) */
  requestId?: string;
}

// Handler type: receives the ask, returns AskResponse or undefined (to fall through to UI)
export type AskHandler = (request: PendingAskRequest) => AskResponse | undefined | Promise<AskResponse | undefined>;

interface AskState {
  pendingRequests: PendingAskRequest[];
  handlers: Map<string, AskHandler[]>;
  /** Set of requestIds that have been timed out but whose entries may not yet be in pendingRequests
   *  (due to the async handler path in handleAskRequest). Prevents stale addition after timeout. */
  timedOutRequestIds: Set<string>;
}

interface AskActions {
  addPendingRequest: (request: PendingAskRequest) => void;
  removePendingRequest: (toolCallId: string) => void;
  /** Remove a permission request by its canonical requestId. Falls back to toolCallId for legacy asks.
   *  Also records the requestId as timed out to prevent deferred addition from async handlers. */
  removePendingPermissionRequest: (requestId: string, toolCallId?: string) => void;
  /** Replace all pending permission requests with an authoritative set from the server.
   *  Clears the timedOutRequestIds set since the server set is authoritative. */
  replacePendingPermissionRequests: (requests: PendingAskRequest[]) => void;
  clearPendingRequests: () => void;
  clearPendingRequestsBySessionId: (sessionId: string) => void;
  registerHandler: (target: AskTarget, handler: AskHandler) => void;
  unregisterHandler: (target: AskTarget, handler: AskHandler) => void;
  getHandlers: (target: AskTarget) => AskHandler[];
}

type AskStore = AskState & AskActions;

export const useAskStore = create<AskStore>((set, get) => ({
  pendingRequests: [],
  handlers: new Map(),
  timedOutRequestIds: new Set(),

  addPendingRequest: (request) =>
    set((state) => {
      // For permission asks with a requestId, check if it was already timed out
      // (handles the race where timeout arrives before the async handler resolves)
      if (request.ask.type === 'permission' && request.requestId && state.timedOutRequestIds.has(request.requestId)) {
        return state;
      }

      // For permission asks, deduplicate by requestId (canonical identity)
      // For generic asks, deduplicate by toolCallId (legacy behavior)
      const isPermission = request.ask.type === 'permission';
      const filtered = isPermission && request.requestId
        ? state.pendingRequests.filter(
            (r) => !(r.ask.type === 'permission' && r.requestId === request.requestId),
          )
        : state.pendingRequests.filter((r) => r.toolCallId !== request.toolCallId);

      return {
        pendingRequests: [...filtered, request],
      };
    }),

  removePendingRequest: (toolCallId) =>
    set((state) => ({
      pendingRequests: state.pendingRequests.filter((r) => r.toolCallId !== toolCallId),
    })),

  removePendingPermissionRequest: (requestId, toolCallId) =>
    set((state) => {
      // Record this requestId as timed out to prevent deferred addition
      const nextTimedOut = new Set(state.timedOutRequestIds);
      nextTimedOut.add(requestId);

      // Try to find by requestId first (canonical for permission asks)
      const byRequestId = state.pendingRequests.findIndex(
        (r) => r.ask.type === 'permission' && r.requestId === requestId,
      );
      if (byRequestId !== -1) {
        return {
          timedOutRequestIds: nextTimedOut,
          pendingRequests: state.pendingRequests.filter((_, i) => i !== byRequestId),
        };
      }
      // Fallback to toolCallId for legacy/compat
      if (toolCallId) {
        return {
          timedOutRequestIds: nextTimedOut,
          pendingRequests: state.pendingRequests.filter((r) => r.toolCallId !== toolCallId),
        };
      }
      return { timedOutRequestIds: nextTimedOut };
    }),

  replacePendingPermissionRequests: (requests) =>
    set((state) => {
      // Keep only non-permission pending requests, then add the new permission set
      const nonPermission = state.pendingRequests.filter((r) => r.ask.type !== 'permission');
      // Clear timedOutRequestIds — the authoritative server set supersedes local stale tracking
      return {
        timedOutRequestIds: new Set(),
        pendingRequests: [...nonPermission, ...requests],
      };
    }),

  clearPendingRequests: () => set({ pendingRequests: [], timedOutRequestIds: new Set() }),

  clearPendingRequestsBySessionId: (sessionId) =>
    set((state) => ({
      pendingRequests: state.pendingRequests.filter(
        (r) => r.sessionId !== sessionId && r.originSessionId !== sessionId,
      ),
    })),

  registerHandler: (target, handler) => {
    set((state) => {
      const next = new Map(state.handlers);
      const existing = next.get(target) ?? [];
      next.set(target, [...existing, handler]);
      return { handlers: next };
    });
  },

  unregisterHandler: (target, handler) => {
    set((state) => {
      const next = new Map(state.handlers);
      const existing = next.get(target);
      if (existing) {
        next.set(target, existing.filter((h) => h !== handler));
      }
      return { handlers: next };
    });
  },

  getHandlers: (target) => {
    return get().handlers.get(target) ?? [];
  },
}));