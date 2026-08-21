import type { AskAuthority, ServerMessage } from '@prokopai/sdk';
import { getControllerConnections, getParticipantConnections } from './control-registry';
import type { ConnectionId } from './connection-id';

/**
 * Injected delivery port owned by transport.
 *
 * Covers the five audiences used by Jean2: origin, session, controller,
 * ask-target, and global broadcast. Production bootstrap installs the concrete
 * port created by the Bun adapter; nothing else registers module-level
 * delivery callbacks for application behavior.
 */
export interface DeliveryPort {
  readonly sendToConnection: (connectionId: ConnectionId, message: ServerMessage) => void;
  readonly broadcast: (message: ServerMessage, excludeConnectionId?: ConnectionId) => void;
  readonly broadcastToSession: (sessionId: string, message: ServerMessage, excludeConnectionId?: ConnectionId) => void;
  readonly sendToController: (sessionId: string, message: ServerMessage) => void;
  readonly sendToAskTargets: (sessionId: string, authority: AskAuthority, message: ServerMessage) => void;
}

export interface DeliveryPortDeps {
  /** Origin delivery: sends without a readyState check, matching the legacy origin send. */
  sendToConnection(connectionId: ConnectionId, message: ServerMessage): void;
  /** Audience delivery: only sends to open sockets, matching legacy audience delivery. */
  sendToOpenConnection(connectionId: ConnectionId, message: ServerMessage): void;
  /** All chat connections, in registration order, for global broadcast. */
  connectionIds(): ConnectionId[];
  /** Resolved participant connections for a session. */
  participantConnectionIds(sessionId: string): ConnectionId[];
  /** Resolved controller connections for a session. */
  controllerConnectionIds(sessionId: string): ConnectionId[];
  /** Ask delivery targets resolved from the ask authority. Injected from bootstrap. */
  askTargetConnectionIds(sessionId: string, authority: AskAuthority): ConnectionId[];
}

export function createDeliveryPort(deps: DeliveryPortDeps): DeliveryPort {
  return {
    sendToConnection(connectionId, message) {
      deps.sendToConnection(connectionId, message);
    },

    broadcast(message, excludeConnectionId) {
      for (const connectionId of deps.connectionIds()) {
        if (connectionId === excludeConnectionId) continue;
        deps.sendToOpenConnection(connectionId, message);
      }
    },

    broadcastToSession(sessionId, message, excludeConnectionId) {
      for (const connectionId of deps.participantConnectionIds(sessionId)) {
        if (connectionId === excludeConnectionId) continue;
        deps.sendToOpenConnection(connectionId, message);
      }
    },

    sendToController(sessionId, message) {
      for (const connectionId of deps.controllerConnectionIds(sessionId)) {
        deps.sendToOpenConnection(connectionId, message);
      }
    },

    sendToAskTargets(sessionId, authority, message) {
      const targets = deps.askTargetConnectionIds(sessionId, authority);
      if (targets.length === 0) {
        // Legacy parity: zero capability-aware targets fall back to
        // controller delivery. Empty controller resolution sends nothing.
        for (const connectionId of deps.controllerConnectionIds(sessionId)) {
          deps.sendToOpenConnection(connectionId, message);
        }
        return;
      }
      for (const connectionId of targets) {
        deps.sendToConnection(connectionId, message);
      }
    },
  };
}

export function participantConnectionIdsFor(sessionId: string): ConnectionId[] {
  return getParticipantConnections(sessionId).map((conn) => conn.connectionId);
}

export function controllerConnectionIdsFor(sessionId: string): ConnectionId[] {
  return getControllerConnections(sessionId).map((conn) => conn.connectionId);
}
