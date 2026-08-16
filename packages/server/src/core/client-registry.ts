/**
 * Temporary forwarding module (S2).
 *
 * The connection registry now lives in `transport/websocket/connection-registry`
 * and keys connections by an opaque ConnectionId. This module keeps the old
 * socket-based signatures working until consumers migrate.
 */
import {
  registerConnection as registerTransportConnection,
  unregisterConnection as unregisterTransportConnection,
  handleClientRegistration as handleTransportClientRegistration,
  getConnectionBySocket,
  getClientIdForSocket,
  touchConnection as touchTransportConnection,
} from '@/transport/websocket/connection-registry';
import type { ClientRegisterMessage, ServerMessage } from '@jean2/sdk';

export {
  getConnectionById,
  getClientByClientId,
  getRegisteredClientCount,
  getConnectionCount,
  getAllClients,
  getConnectionsForClient,
  getAllConnectionsWithActiveSession,
  type RegisteredClient,
  type RegisteredConnection,
} from '@/transport/websocket/connection-registry';

export function registerConnection(ws: unknown): string {
  return registerTransportConnection(ws);
}

export function unregisterConnection(ws: unknown): void {
  unregisterTransportConnection(ws);
}

export function getConnectionByWs(ws: unknown) {
  return getConnectionBySocket(ws);
}

export function getClientIdForWs(ws: unknown): string | null {
  return getClientIdForSocket(ws);
}

export function isClientRegistered(ws: unknown): boolean {
  return getConnectionBySocket(ws)?.clientId != null;
}

export function touchConnection(ws: unknown): void {
  touchTransportConnection(ws);
}

export function handleClientRegistration(
  ws: unknown,
  msg: ClientRegisterMessage,
  send: (ws: unknown, msg: ServerMessage) => void,
): void {
  const conn = getConnectionBySocket(ws);
  if (!conn) return;
  handleTransportClientRegistration(conn.connectionId, msg, (_connectionId, message) => {
    send(conn.ws, message);
  });
}
