import type { AskAuthority, ServerMessage } from '@jean2/sdk';

/**
 * Application-facing delivery port.
 *
 * Covers the five Jean2 audiences without knowing how they are resolved:
 * origin, session, controller, ask-target, and global broadcast. The
 * transport layer adapts its router context to this contract per message.
 */
export interface ApplicationDeliveryPort<Origin> {
  send(origin: Origin, message: ServerMessage): void;
  broadcast(message: ServerMessage, excludeOrigin?: Origin): void;
  broadcastToSession(sessionId: string, message: ServerMessage, excludeOrigin?: Origin): void;
  sendToController(sessionId: string, message: ServerMessage): void;
  sendToAskTargets(sessionId: string, authority: AskAuthority, message: ServerMessage): void;
}

/**
 * Connection session bookkeeping. The transport layer owns the actual client
 * map; use cases only attach an origin to a session so disconnect cleanup and
 * participant resolution keep working exactly as before.
 */
export interface OriginRegistryPort<Origin> {
  attachOriginToSession(origin: Origin, sessionId: string): void;
}

/**
 * Per-message wire ports handed to every WebSocket use case. Delivery and
 * origin bookkeeping are derived from the transport router context at
 * dispatch time; everything else is bound once at composition time.
 */
export interface SessionWirePorts<Origin> {
  delivery: ApplicationDeliveryPort<Origin>;
  actor: OriginRegistryPort<Origin>;
}
