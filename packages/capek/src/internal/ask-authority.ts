/**
 * Internal ask authority entrypoint (`@capekai/core/internal/ask-authority`).
 *
 * Exposes exactly the pending-ask permission identities the Jean2 server
 * consumes at the wire boundary: response resolution, pending-ask session
 * and authority lookup, and the fixed ask timeout. Every symbol resolves to
 * the owning module's identity, identical to the compatibility barrel.
 * S8a/S8d: this is the single authority surface for pending-ask
 * resolution; the server consumes it only through the ask-authority
 * adapter.
 */

export {
  ASK_TIMEOUT,
  getAuthorityForPendingAsk,
  getSessionIdForPendingAsk,
  resolveAsk,
} from '../permission/ask-user-api';
