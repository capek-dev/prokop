import type { ServerMessage, AskAuthority } from '@prokopai/sdk';
import type { ConnectionId } from './connection-id';
import type { ControllerGateRejection } from './control-registry';

export interface ClientEntry {
  sessionIds: Set<string>;
  missedPings: number;
}

/**
 * Transport context handed to wire handlers.
 *
 * The origin is the opaque ConnectionId. Only the Bun adapter ever maps it
 * back to a socket.
 */
export interface RouterContext<Origin = ConnectionId> {
  send: (origin: Origin, msg: ServerMessage) => void;
  broadcast: (message: ServerMessage, excludeOrigin?: Origin) => void;
  broadcastToSession: (sessionId: string, message: ServerMessage, excludeOrigin?: Origin) => void;
  sendToController: (sessionId: string, message: ServerMessage) => void;
  sendToAskTargets: (sessionId: string, authority: AskAuthority, message: ServerMessage) => void;
  clients: Map<Origin, ClientEntry>;
}

export function sendGateRejection(
  ctx: RouterContext<ConnectionId>,
  connectionId: ConnectionId,
  rejection: ControllerGateRejection,
): true {
  ctx.send(connectionId, {
    type: 'session.action_rejected',
    sessionId: rejection.sessionId,
    action: rejection.action,
    code: rejection.code,
    message: rejection.message,
    control: rejection.control,
  });
  return true;
}
