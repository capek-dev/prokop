import type {
  ControllerGatePort,
  ControllerGateRejection,
  SessionControlPort,
  SessionControlActionResult,
  SessionResumeControlResult,
} from '@/application/ports/control';
import type { ServerMessage, SessionControlUpdateReason, TakeoverDecision } from '@jean2/sdk';
import {
  buildControlUpdatedMessage,
  checkControllerGate,
  handleClaim,
  handleRelease,
  handleRequestTakeover,
  handleRespondTakeover,
  handleSessionResume,
} from './control-registry';
import type { ConnectionId } from './connection-id';

function toGateRejection(
  rejection: ReturnType<typeof checkControllerGate>,
): ControllerGateRejection | null {
  return rejection;
}

function toActionResult(
  result: ReturnType<typeof handleClaim>,
): SessionControlActionResult {
  return result;
}

function toResumeResult(
  result: ReturnType<typeof handleSessionResume>,
): SessionResumeControlResult {
  return result;
}

export interface TransportControllerPorts {
  gate: ControllerGatePort<ConnectionId>;
  control: SessionControlPort<ConnectionId>;
}

/**
 * Transport control port adapter (S3, S4 policy ownership).
 *
 * The controller gate and claim/release/takeover policy live in the named
 * controller domain (`@/domains/controllers`) and are applied by the
 * transport control registry. This module exposes the registry functions
 * through the application port contracts; use cases never import the
 * registry or the domain directly.
 */
export function createTransportControllerPorts(): TransportControllerPorts {
  const gate: ControllerGatePort<ConnectionId> = {
    checkControllerGate(sessionId, action, origin) {
      return toGateRejection(checkControllerGate(sessionId, action, origin));
    },
  };

  const control: SessionControlPort<ConnectionId> = {
    claim(sessionId, origin) {
      return toActionResult(handleClaim(sessionId, origin));
    },
    release(sessionId, origin) {
      return toActionResult(handleRelease(sessionId, origin));
    },
    requestTakeover(sessionId, origin, autoApprove) {
      return toActionResult(handleRequestTakeover(sessionId, origin, autoApprove));
    },
    respondTakeover(sessionId, origin, requesterClientId, decision: TakeoverDecision) {
      return toActionResult(handleRespondTakeover(sessionId, origin, requesterClientId, decision));
    },
    resumeControl(sessionId, origin) {
      return toResumeResult(handleSessionResume(sessionId, origin));
    },
    buildControlUpdatedMessage(sessionId, reason: SessionControlUpdateReason): ServerMessage {
      return buildControlUpdatedMessage(sessionId, reason);
    },
  };

  return { gate, control };
}
