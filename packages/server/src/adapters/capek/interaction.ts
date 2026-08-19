import { getPermissionTimeoutMs } from '@/infrastructure/runtime/environment';
import { getSession } from '@/infrastructure/sqlite/session-store';
import {
  cancelPendingRequestsBySession,
  createPendingAsk,
  expireOldPermissionRequests,
  expirePermissionRequest,
  getPermissionRequestByRequestId,
  listPendingAsksByRootSession,
  listPendingAsksBySession,
  listPendingRequestsByRootSession,
  removePendingAsk,
  removePendingAsksByToolCallId,
  resolvePermissionRequestByRequestId,
} from '@/infrastructure/sqlite/pending-asks';
import { createGrantFromOptions, matchGrant } from '@/infrastructure/sqlite/permissions';
import { getJean2NotificationsApplication } from '@/adapters/jean2/notifications';
import type { Jean2CompatibilityBindings } from './types';

export const jean2InteractionBindings: Jean2CompatibilityBindings['interaction'] = {
  createPendingAsk: async (record) => createPendingAsk(record),
  removePendingAsk: async (id) => {
    removePendingAsk(id);
  },
  removePendingAsksByToolCallId: async (toolCallId) => {
    removePendingAsksByToolCallId(toolCallId);
  },
  getPermissionRequestByRequestId: async (requestId) => getPermissionRequestByRequestId(requestId),
  resolvePermissionRequestByRequestId: async (requestId, status, resolution) =>
    resolvePermissionRequestByRequestId(requestId, status, resolution),
  expirePermissionRequest: async (id) => expirePermissionRequest(id),
  expireOldPermissionRequests: async (maxAgeMs) => expireOldPermissionRequests(maxAgeMs),
  cancelPendingRequestsBySession: async (sessionId) => cancelPendingRequestsBySession(sessionId),
  listPendingAsksBySession: async (sessionId) => listPendingAsksBySession(sessionId),
  listPendingAsksByRootSession: async (rootSessionId) => listPendingAsksByRootSession(rootSessionId),
  listPendingRequestsByRootSession: async (rootSessionId) => listPendingRequestsByRootSession(rootSessionId),
  matchGrant: async (params) => matchGrant(params),
  createGrantFromOptions: async (params) => createGrantFromOptions(params),
  getSessionAutoApproveSeverity: async (sessionId) => getSession(sessionId)?.autoApproveSeverity ?? undefined,
  getPermissionTimeoutMs,
  notifyPermissionRequired: async (requestId: string, rootSessionId: string) => {
    getJean2NotificationsApplication().notifyPermissionRequired(requestId, rootSessionId);
  },
};
