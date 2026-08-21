import type { TakeoverDecision } from '@prokopai/sdk';
import type { ApplicationDeliveryPort } from '../ports/delivery';
import type { SessionControlPort } from '../ports/control';

export interface SessionControlDeps<Origin> {
  control: SessionControlPort<Origin>;
  autoApproveTakeover(): boolean;
}

export interface SessionControlApplication<Origin> {
  claim(delivery: ApplicationDeliveryPort<Origin>, origin: Origin, sessionId: string): void;
  release(delivery: ApplicationDeliveryPort<Origin>, origin: Origin, sessionId: string): void;
  requestTakeover(delivery: ApplicationDeliveryPort<Origin>, origin: Origin, sessionId: string): void;
  respondTakeover(
    delivery: ApplicationDeliveryPort<Origin>,
    origin: Origin,
    sessionId: string,
    requesterClientId: string,
    decision: TakeoverDecision,
  ): void;
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

    requestTakeover(delivery, origin, sessionId): void {
      deliverOutcome(
        delivery,
        origin,
        sessionId,
        deps.control.requestTakeover(sessionId, origin, deps.autoApproveTakeover()),
      );
    },

    respondTakeover(delivery, origin, sessionId, requesterClientId, decision): void {
      deliverOutcome(
        delivery,
        origin,
        sessionId,
        deps.control.respondTakeover(sessionId, origin, requesterClientId, decision),
      );
    },
  };
}
