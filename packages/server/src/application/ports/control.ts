import type {
  ControllerGatedAction,
  ServerMessage,
  SessionControlState,
  SessionControlUpdateReason,
  TakeoverDecision,
} from '@jean2/sdk';

/**
 * Controller gate rejection, structural copy of the transport registry
 * rejection. The policy implementation stays in the transport control
 * registry until S4; the gate port exposes it to use cases unchanged.
 */
export interface ControllerGateRejection {
  sessionId: string;
  action: ControllerGatedAction;
  code: 'not_controller' | 'session_uncontrolled' | 'registration_required';
  message: string;
  control: SessionControlState;
}

export interface ControllerGatePort<Origin> {
  checkControllerGate(
    sessionId: string,
    action: ControllerGatedAction,
    origin: Origin,
  ): ControllerGateRejection | null;
}

export type SessionControlActionResult =
  | { success: true; controlState: SessionControlState; transitionReason: SessionControlUpdateReason }
  | { success: false; error: string; code: string; controlState: SessionControlState };

export interface SessionResumeControlResult {
  controlState: SessionControlState;
  transitionReason: SessionControlUpdateReason | null;
}

/**
 * Session control operations port. The claim/release/takeover state machine
 * stays in the transport control registry; use cases only orchestrate the
 * outcome delivery in the exact current order.
 */
export interface SessionControlPort<Origin> {
  claim(sessionId: string, origin: Origin): SessionControlActionResult;
  release(sessionId: string, origin: Origin): SessionControlActionResult;
  requestTakeover(sessionId: string, origin: Origin, autoApprove: boolean): SessionControlActionResult;
  respondTakeover(
    sessionId: string,
    origin: Origin,
    requesterClientId: string,
    decision: TakeoverDecision,
  ): SessionControlActionResult;
  resumeControl(sessionId: string, origin: Origin): SessionResumeControlResult;
  buildControlUpdatedMessage(sessionId: string, reason: SessionControlUpdateReason): ServerMessage;
}
