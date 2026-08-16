/**
 * C6 pinned compatibility forwarder. The generic ask lifecycle and state
 * moved to the permission domain (`permission/policy.ts` owns the scoped
 * service; `permission/ask-user-api.ts` owns this export surface). Every
 * prior export resolves to the same identity, so `compat/jean2.ts`, the tool
 * builders, the interrupt and retry cleanup paths, the facade, and the
 * server ask-response handler keep working unchanged until C8 retires the
 * compat surface.
 */

export {
  ASK_TIMEOUT,
  createAskApi,
  getAuthorityForPendingAsk,
  getSessionIdForPendingAsk,
  hasPendingAsk,
  listPendingAsksByRootSession,
  listPendingAsksBySession,
  rejectAsk,
  rejectPendingAsksBySession,
  rejectPendingAsksByToolCallId,
  resolveAsk,
} from '../permission/ask-user-api';
export type { AskBroadcastFn } from '../permission/ask-user-api';
