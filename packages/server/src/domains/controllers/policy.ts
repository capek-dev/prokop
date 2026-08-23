import type {
  ControllerGatedAction,
  SessionControlState,
  SessionControlUpdateReason,
} from '@prokopai/sdk';

/**
 * Controller domain: single-controller control policy.
 *
 * Jean2 product policy: a session has at most one controller, and control
 * belongs to whoever last claimed it. Claiming always succeeds for a
 * registered client (last click wins, no permission handshake), releasing
 * is controller-only, and a client disconnecting never changes control.
 * These are pure decision functions over a plain `ControllerRecord`: they
 * own every transition rule, error code, and message, and they mutate only
 * the record passed in. The transport control registry owns the
 * registries, connection lookups, and console logs; it applies these
 * decisions unchanged.
 *
 * The record uses `unknown` for the controller connection so the domain
 * never imports transport types. The shared capek wire union keeps
 * historical grace/takeover status variants for compatibility; this
 * policy never produces them.
 */

export interface ControllerRecord {
  sessionId: string;
  controllerClientId: string | null;
  controllerConnectionId: unknown;
  status: 'uncontrolled' | 'controlled';
  acquiredAt: number | null;
}

export function makeUncontrolledRecord(sessionId: string): ControllerRecord {
  return {
    sessionId,
    controllerClientId: null,
    controllerConnectionId: null,
    status: 'uncontrolled',
    acquiredAt: null,
  };
}

export function makeUncontrolledState(sessionId: string): SessionControlState {
  return recordToState(makeUncontrolledRecord(sessionId));
}

export function recordToState(record: ControllerRecord): SessionControlState {
  return {
    sessionId: record.sessionId,
    controllerClientId: record.controllerClientId,
    controllerConnectionId: record.controllerConnectionId as string | null,
    acquiredAt: record.acquiredAt,
    status: record.status,
  };
}

export interface ControllerGateRejection {
  sessionId: string;
  action: ControllerGatedAction;
  code: 'not_controller' | 'session_uncontrolled' | 'registration_required';
  message: string;
  control: SessionControlState;
}

/** Controller gate decision: uncontrolled sessions pass for anyone; a
 * controlled session requires the controlling client's registration. */
export function decideControllerGate(
  record: ControllerRecord | undefined,
  clientId: string | null,
  sessionId: string,
  action: ControllerGatedAction,
): ControllerGateRejection | null {
  if (!record || record.status === 'uncontrolled') {
    return null;
  }

  if (!clientId) {
    return {
      sessionId,
      action,
      code: 'registration_required',
      message: 'Client must be registered to perform this action',
      control: recordToState(record),
    };
  }

  if (record.controllerClientId === clientId) {
    return null;
  }

  return {
    sessionId,
    action,
    code: 'not_controller',
    message: 'Only the current controller can perform this action',
    control: recordToState(record),
  };
}

/** Auto-claim eligibility policy: only human or hybrid clients may be
 * passively auto-claimed as controllers on resume. */
export function isAutoClaimEligible(interactionMode: string): boolean {
  return interactionMode === 'human' || interactionMode === 'hybrid';
}

/** Apply an auto-claim when the record is uncontrolled and the client is
 * eligible. Returns the post-transition state. */
export function applyAutoClaim(
  record: ControllerRecord,
  clientId: string,
  connectionId: unknown,
  now: number,
  eligible: boolean,
): SessionControlState {
  if (record.status !== 'uncontrolled' || !eligible) {
    return recordToState(record);
  }

  record.controllerClientId = clientId;
  record.controllerConnectionId = connectionId;
  record.status = 'controlled';
  record.acquiredAt = now;

  return recordToState(record);
}

export type ControlActionResult =
  | { success: true; controlState: SessionControlState; transitionReason: SessionControlUpdateReason }
  | { success: false; error: string; code: string; controlState: SessionControlState };

/** Claim control: last click wins. Any registered client becomes the
 * controller immediately, regardless of the previous controller. */
export function applyClaim(
  record: ControllerRecord | undefined,
  sessionId: string,
  clientId: string | null,
  connectionId: unknown,
  now: number,
): ControlActionResult {
  if (!clientId) {
    return {
      success: false,
      error: 'Client must be registered before claiming control',
      code: 'registration_required',
      controlState: record ? recordToState(record) : makeUncontrolledState(sessionId),
    };
  }

  if (!record) {
    return {
      success: false,
      error: 'No control record for this session',
      code: 'not_controller',
      controlState: makeUncontrolledState(sessionId),
    };
  }

  record.controllerClientId = clientId;
  record.controllerConnectionId = connectionId;
  record.status = 'controlled';
  record.acquiredAt = now;

  return {
    success: true,
    controlState: recordToState(record),
    transitionReason: 'claimed',
  };
}

export function applyRelease(
  record: ControllerRecord | undefined,
  sessionId: string,
  clientId: string | null,
): ControlActionResult {
  if (!clientId) {
    return {
      success: false,
      error: 'Client must be registered before releasing control',
      code: 'registration_required',
      controlState: record ? recordToState(record) : makeUncontrolledState(sessionId),
    };
  }

  if (!record) {
    return {
      success: false,
      error: 'No control record for this session',
      code: 'not_controller',
      controlState: makeUncontrolledState(sessionId),
    };
  }

  if (record.controllerClientId !== clientId) {
    return {
      success: false,
      error: 'Only the current controller can release control',
      code: 'not_controller',
      controlState: recordToState(record),
    };
  }

  if (record.status !== 'controlled') {
    return {
      success: false,
      error: `Cannot release control from status '${record.status}'`,
      code: 'invalid_state',
      controlState: recordToState(record),
    };
  }

  record.controllerClientId = null;
  record.controllerConnectionId = null;
  record.status = 'uncontrolled';
  record.acquiredAt = null;

  return {
    success: true,
    controlState: recordToState(record),
    transitionReason: 'released',
  };
}

export interface SessionResumeControlResult {
  controlState: SessionControlState;
  transitionReason: SessionControlUpdateReason | null;
}

/** Resume decision: auto-claim an uncontrolled session for the resuming
 * client when eligible. Control is never taken from another client by
 * resuming. Participant bookkeeping stays in transport. */
export function applyResume(
  record: ControllerRecord,
  clientId: string | null,
  connectionId: unknown,
  now: number,
  autoClaimEligible: boolean,
): SessionResumeControlResult {
  let transitionReason: SessionControlUpdateReason | null = null;

  if (clientId && record.status === 'uncontrolled') {
    const previousStatus = record.status;
    applyAutoClaim(record, clientId, connectionId, now, autoClaimEligible);
    if (record.status !== previousStatus) {
      transitionReason = 'auto_claimed';
    }
  }

  return {
    controlState: recordToState(record),
    transitionReason,
  };
}
