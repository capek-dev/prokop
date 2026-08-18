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
  createPendingAsk,
  removePendingAsk,
  removePendingAsksByToolCallId,
  getPermissionRequestByRequestId,
  resolvePermissionRequestByRequestId,
  expirePermissionRequest,
  expireOldPermissionRequests,
  cancelPendingRequestsBySession,
  listPendingAsksBySession,
  listPendingAsksByRootSession,
  listPendingRequestsByRootSession,
  matchGrant,
  createGrantFromOptions,
  getSessionAutoApproveSeverity: (sessionId: string) => getSession(sessionId)?.autoApproveSeverity ?? undefined,
  getPermissionTimeoutMs,
  notifyPermissionRequired: (requestId: string, rootSessionId: string) =>
    getJean2NotificationsApplication().notifyPermissionRequired(requestId, rootSessionId),
};
