/**
 * C6 pinned compatibility forwarder. The permission waiters, timers, grant
 * reuse, validation, and audit decisions moved to the permission domain
 * (`permission/policy.ts` owns the scoped service;
 * `permission/permission-request-manager.ts` owns this export surface).
 * Every prior export resolves to the same identity, so the server permission
 * tests and `internal/ask-authority.ts` keep working unchanged.
 */

export {
  PERMISSION_TIMEOUT,
  expireOldRequests,
  getPendingRequestsByRootSession,
  getPendingWaiterCount,
  hasPendingWaiter,
  rejectPermission,
  rejectPermissionsBySession,
  rejectPermissionsByToolCallId,
  requestPermission,
  resolvePermission,
} from '../permission/permission-request-manager';
export type {
  PermissionBroadcastFn,
  RequestPermissionParams,
} from '../permission/permission-request-manager';
