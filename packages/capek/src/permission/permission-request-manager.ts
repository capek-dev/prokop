/**
 * C6 permission lifecycle surface over the NON-REPLACEABLE permission
 * runtime. These exports preserve the exact pre-C6
 * `tools/permission-request-manager.ts` identities; the waiters, timers,
 * grant reuse, validation, and audit decisions resolve through
 * `getPermissionRuntimeService()`.
 *
 * The runtime enforces the mandatory deny invariant from the module-level
 * `isValidPermissionResponse` (never from provider advice), records the raw
 * payload in the denied audit record (preserving the pre-C6 audit
 * behavior), and persists only the canonical `buildGrantParams` output, so
 * a replaced advice provider can never approve malformed responses or
 * create grants outside the canonical allowed scopes.
 */

import type { PendingAskRecord } from '../runtime/host';
import { getPermissionRuntimeService, } from './runtime';
import { PERMISSION_TIMEOUT } from './policy';
import type { PermissionBroadcastFn, RequestPermissionParams } from './contracts';

export { PERMISSION_TIMEOUT };
export type { PermissionBroadcastFn, RequestPermissionParams };

export function requestPermission(params: RequestPermissionParams): Promise<unknown> {
  return getPermissionRuntimeService().requestPermission(params);
}

export function resolvePermission(requestId: string, response: unknown): boolean {
  return getPermissionRuntimeService().resolvePermission(requestId, response);
}

export function rejectPermission(requestId: string, error: Error): boolean {
  return getPermissionRuntimeService().rejectPermission(requestId, error);
}

export function rejectPermissionsByToolCallId(toolCallId: string, error?: Error): string[] {
  return getPermissionRuntimeService().rejectPermissionsByToolCallId(toolCallId, error);
}

export function rejectPermissionsBySession(sessionId: string, error?: Error): string[] {
  return getPermissionRuntimeService().rejectPermissionsBySession(sessionId, error);
}

export function getPendingRequestsByRootSession(rootSessionId: string): PendingAskRecord[] {
  return getPermissionRuntimeService().getPendingRequestsByRootSession(rootSessionId);
}

export function expireOldRequests(maxAgeMs: number): number {
  return getPermissionRuntimeService().expireOldRequests(maxAgeMs);
}

export function hasPendingWaiter(requestId: string): boolean {
  return getPermissionRuntimeService().hasPendingWaiter(requestId);
}

export function getPendingWaiterCount(): number {
  return getPermissionRuntimeService().getPendingWaiterCount();
}
