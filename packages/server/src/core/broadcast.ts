import type { ServerMessage, Session, AskAuthority } from '@jean2/sdk';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { getConnectionByWs } from './client-registry';

export type BroadcastFn = (message: ServerMessage) => void;

export type BroadcastSessionFn = (session: Session) => void;

export type SendToControllerFn = (sessionId: string, message: ServerMessage) => void;

export type BroadcastToSessionFn = (sessionId: string, message: ServerMessage) => void;

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
 * `installDeliveryPort`. The legacy `register*Callback` functions remain only
 * for temporary forwarding and test compatibility.
 */
export interface DeliveryPort {
  readonly sendToConnection: (connectionId: ConnectionId, message: ServerMessage) => void;
  readonly broadcast: (message: ServerMessage, excludeConnectionId?: ConnectionId) => void;
  readonly broadcastToSession: (sessionId: string, message: ServerMessage, excludeConnectionId?: ConnectionId) => void;
  readonly sendToController: (sessionId: string, message: ServerMessage) => void;
  readonly sendToAskTargets: (sessionId: string, authority: AskAuthority, message: ServerMessage) => void;
}

type BroadcastCallback = (message: ServerMessage, excludeWs?: unknown) => void;

let installedPort: DeliveryPort | null = null;

let broadcastCallback: BroadcastCallback | null = null;
let sendToControllerCallback: SendToControllerFn | null = null;
let broadcastToSessionCallback: BroadcastToSessionFn | null = null;

export function installDeliveryPort(port: DeliveryPort): void {
  installedPort = port;
}

export function registerBroadcastCallback(callback: BroadcastCallback): void {
  broadcastCallback = callback as BroadcastCallback;
}

export function registerSendToControllerCallback(callback: SendToControllerFn): void {
  sendToControllerCallback = callback;
}

export function registerBroadcastToSessionCallback(callback: BroadcastToSessionFn): void {
  broadcastToSessionCallback = callback;
}

function toConnectionId(excludeWs: unknown): ConnectionId | undefined {
  if (excludeWs === undefined || excludeWs === null) return undefined;
  return getConnectionByWs(excludeWs)?.connectionId;
}

export function broadcastSessionCreated(session: Session): void {
  const message: ServerMessage = {
    type: 'session.created',
    session,
  };

  if (installedPort) {
    installedPort.broadcast(message);
    return;
  }

  if (!broadcastCallback) {
    console.error('Broadcast callback not registered. Call registerBroadcastCallback first.');
    return;
  }

  broadcastCallback(message);
}

export function broadcastSessionCreatedExclude(session: Session, excludeWs: unknown): void {
  const message: ServerMessage = {
    type: 'session.created',
    session,
  };

  if (installedPort) {
    installedPort.broadcast(message, toConnectionId(excludeWs));
    return;
  }

  if (!broadcastCallback) {
    console.error('Broadcast callback not registered. Call registerBroadcastCallback first.');
    return;
  }

  broadcastCallback(message, excludeWs);
}

export function broadcastSessionUpdated(session: Session): void {
  const message: ServerMessage = {
    type: 'session.updated',
    session,
  };

  if (installedPort) {
    installedPort.broadcast(message);
    return;
  }

  if (!broadcastCallback) {
    console.error('Broadcast callback not registered. Call registerBroadcastCallback first.');
    return;
  }

  broadcastCallback(message);
}

export function broadcastEvent(message: ServerMessage): void {
  if (installedPort) {
    installedPort.broadcast(message);
    return;
  }
  if (!broadcastCallback) return;
  broadcastCallback(message);
}

export function sendToControllerEvent(sessionId: string, message: ServerMessage): void {
  if (installedPort) {
    installedPort.sendToController(sessionId, message);
    return;
  }
  if (!sendToControllerCallback) {
    broadcastEvent(message);
    return;
  }
  sendToControllerCallback(sessionId, message);
}

export function broadcastToSessionEvent(sessionId: string, message: ServerMessage): void {
  if (installedPort) {
    installedPort.broadcastToSession(sessionId, message);
    return;
  }
  if (!broadcastToSessionCallback) {
    broadcastEvent(message);
    return;
  }
  broadcastToSessionCallback(sessionId, message);
}

/**
 * Send an ask to the delivery targets resolved from the ask's authority.
 *
 * With an installed delivery port this delegates to transport resolution
 * (the ask-routing domain is the single target-resolution owner, injected
 * at bootstrap). The legacy callback path is controller-only fallback
 * delivery; it no longer re-resolves ask-target policy.
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
