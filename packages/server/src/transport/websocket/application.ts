import type {
  NotificationsApplication,
  PermissionsApplication,
  ProvidersApplication,
  SessionApplication,
  SessionControlApplication,
  SessionWirePorts,
} from '@/application';
import type { RouterContext } from './router-context';
import type { ConnectionId } from './connection-id';

export interface WireApplication {
  session: SessionApplication<ConnectionId>;
  control: SessionControlApplication<ConnectionId>;
  providers: ProvidersApplication;
  notifications: NotificationsApplication;
  permissions: PermissionsApplication;
}

let installed: WireApplication | null = null;

/**
 * Composition seam (S3). Production bootstrap installs the wired application
 * before the WebSocket adapter starts dispatching. Nothing else registers
 * module-level delivery callbacks for application behavior.
 */
export function installWireApplication(application: WireApplication): void {
  installed = application;
}

export function requireWireApplication(): WireApplication {
  if (!installed) {
    throw new Error(
      'Wire application is not installed. Call installWireApplication() during bootstrap.',
    );
  }
  return installed;
}

/**
 * Derives the per-message wire ports from the transport router context.
 * Delivery delegates to the context senders and origin bookkeeping updates
 * the context client map exactly like the pre-S3 handlers did.
 */
export function createWirePorts(ctx: RouterContext<ConnectionId>): SessionWirePorts<ConnectionId> {
  return {
    delivery: {
      send: ctx.send,
      broadcast: ctx.broadcast,
      broadcastToSession: ctx.broadcastToSession,
      sendToController: ctx.sendToController,
      sendToAskTargets: ctx.sendToAskTargets,
    },
    actor: {
      attachOriginToSession(origin, sessionId) {
        const existing = ctx.clients.get(origin);
        if (existing) {
          existing.sessionIds.add(sessionId);
        } else {
          ctx.clients.set(origin, { sessionIds: new Set([sessionId]), missedPings: 0 });
        }
      },
    },
  };
}
