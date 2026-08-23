import type { ApplicationDeliveryPort } from '../ports/delivery';
import type { SessionControlPort } from '../ports/control';

export interface SessionControlDeps<Origin> {
  control: SessionControlPort<Origin>;
}

export interface SessionControlApplication<Origin> {
  claim(delivery: ApplicationDeliveryPort<Origin>, origin: Origin, sessionId: string): void;
  release(delivery: ApplicationDeliveryPort<Origin>, origin: Origin, sessionId: string): void;
}

export function createSessionControlApplication<Origin>(
  deps: SessionControlDeps<Origin>,
): SessionControlApplication<Origin> {
  function deliverOutcome(
    delivery: ApplicationDeliveryPort<Origin>,
    origin: Origin,
    sessionId: string,
    result: ReturnType<SessionControlPort<Origin>['claim']>,
  ): void {
    if (result.success) {
      delivery.broadcastToSession(
        sessionId,
        deps.control.buildControlUpdatedMessage(sessionId, result.transitionReason),
      );
    } else {
      delivery.send(origin, { type: 'error', code: result.code, message: result.error });
    }
  }

  return {
    claim(delivery, origin, sessionId): void {
      deliverOutcome(delivery, origin, sessionId, deps.control.claim(sessionId, origin));
    },

    release(delivery, origin, sessionId): void {
      deliverOutcome(delivery, origin, sessionId, deps.control.release(sessionId, origin));
    },
  };
}
