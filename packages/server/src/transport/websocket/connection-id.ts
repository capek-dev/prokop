declare const __connectionIdBrand: unique symbol;

/**
 * Opaque connection identifier used by transport.
 *
 * Only the Bun adapter maps a ConnectionId back to a Bun ServerWebSocket.
 * Application and domain code never sees the socket handle.
 */
export type ConnectionId = string & { readonly [__connectionIdBrand]: '__connectionId' };

export function createConnectionId(): ConnectionId {
  return crypto.randomUUID() as ConnectionId;
}
