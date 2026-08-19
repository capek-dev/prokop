import type { ServerMessage, Session, AskAuthority } from '@jean2/sdk';
import type { ConnectionId } from '@/transport/websocket/connection-id';

export type BroadcastFn = (message: ServerMessage) => void;

export type BroadcastSessionFn = (session: Session) => void;

export type SendToAskTargetsFn = (
  sessionId: string,
  authority: AskAuthority,
  message: ServerMessage,
) => void;

/**
 * Delivery port covering the five Jean2 audiences: origin, session,
 * controller, ask-target, and global broadcast.
 *
 * S2 contract: production bootstrap installs the concrete transport port via
 * `installDeliveryPort`.
 */
export interface DeliveryPort {
  readonly sendToConnection: (connectionId: ConnectionId, message: ServerMessage) => void;
  readonly broadcast: (message: ServerMessage, excludeConnectionId?: ConnectionId) => void;
  readonly broadcastToSession: (sessionId: string, message: ServerMessage, excludeConnectionId?: ConnectionId) => void;
  readonly sendToController: (sessionId: string, message: ServerMessage) => void;
  readonly sendToAskTargets: (sessionId: string, authority: AskAuthority, message: ServerMessage) => void;
}

let installedPort: DeliveryPort | null = null;

export function installDeliveryPort(port: DeliveryPort): void {
  installedPort = port;
}

export function broadcastSessionCreated(session: Session): void {
  const message: ServerMessage = {
    type: 'session.created',
    session,
  };

  installedPort?.broadcast(message);
}

export function broadcastSessionCreatedExclude(
  session: Session,
  excludeConnectionId?: ConnectionId,
): void {
  const message: ServerMessage = {
    type: 'session.created',
    session,
  };

  installedPort?.broadcast(message, excludeConnectionId);
}

export function broadcastSessionUpdated(session: Session): void {
  const message: ServerMessage = {
    type: 'session.updated',
    session,
  };

  installedPort?.broadcast(message);
}

export function broadcastEvent(message: ServerMessage): void {
  installedPort?.broadcast(message);
}

export function sendToControllerEvent(sessionId: string, message: ServerMessage): void {
  if (installedPort) {
    installedPort.sendToController(sessionId, message);
    return;
  }
  broadcastEvent(message);
}

export function broadcastToSessionEvent(sessionId: string, message: ServerMessage): void {
  if (installedPort) {
    installedPort.broadcastToSession(sessionId, message);
    return;
  }
  broadcastEvent(message);
}

/**
 * Send an ask to the delivery targets resolved from the ask's authority.
 *
 * With an installed delivery port this delegates to transport resolution
 * (the ask-routing domain is the single target-resolution owner, injected
 * at bootstrap). Without an installed port, delivery falls back to the
 * controller-only path and does not re-resolve ask-target policy.
 */
export function sendToAskTargetsEvent(
  sessionId: string,
  authority: AskAuthority,
  message: ServerMessage,
): void {
  if (installedPort) {
    installedPort.sendToAskTargets(sessionId, authority, message);
    return;
  }

  sendToControllerEvent(sessionId, message);
}
