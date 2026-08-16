import { getPermissionTimeoutMs } from '@/env';
import { getSession } from '@/store';
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
} from '@/store/pending-asks';
import { createGrantFromOptions, matchGrant } from '@/store/permissions';
import { notifyPermissionRequired } from '@/services/web-push/dispatch';
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
  notifyPermissionRequired,
};
