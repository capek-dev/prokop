import type {
  ControllerGatedAction,
  SessionControlState,
  SessionControlStatus,
  SessionControlUpdateReason,
  TakeoverDecision,
} from '@prokopai/sdk';

/**
 * Controller domain: the controller claim/release/takeover state machine
 * policy.
 *
 * Jean2 product policy for who may control a session, how control is
 * acquired, transferred, resumed, and released, and how controller
 * disconnects degrade through grace. These are pure decision functions over
 * a plain `ControllerRecord`: they own every transition rule, error code,
 * and message, and they mutate only the record passed in. The transport
 * control registry owns the registries, connection lookups, timers, sweep
 * scheduling, and console logs; it applies these decisions unchanged.
 *
 * The record uses `unknown` for the controller connection so the domain
 * never imports transport types.
 */

export const GRACE_DURATION_MS = 15_000;
export const TAKEOVER_REQUEST_TIMEOUT_MS = 60_000;

export interface ControllerRecord {
  sessionId: string;
  controllerClientId: string | null;
  controllerConnectionId: unknown;
  status: SessionControlStatus;
  acquiredAt: number | null;
  lastHeartbeatAt: number | null;
  leaseExpiresAt: number | null;
  pendingTakeover: {
    requestedByClientId: string;
    requestedAt: number;
  } | null;
}

export function makeUncontrolledRecord(sessionId: string): ControllerRecord {
  return {
    sessionId,
    controllerClientId: null,
    controllerConnectionId: null,
    status: 'uncontrolled',
    acquiredAt: null,
    lastHeartbeatAt: null,
    leaseExpiresAt: null,
    pendingTakeover: null,
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
    lastHeartbeatAt: record.lastHeartbeatAt,
    leaseExpiresAt: record.leaseExpiresAt,
    status: record.status,
    pendingTakeover: record.pendingTakeover,
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
 * auto-claimed as controllers. */
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
  record.lastHeartbeatAt = now;
  record.leaseExpiresAt = null;
  record.pendingTakeover = null;

  return recordToState(record);
}

/** Enter the grace window for a controlled session whose controller
 * disconnected. Returns false when the record is not controlled. */
export function applyGraceEntry(record: ControllerRecord | undefined, now: number): boolean {
  if (!record || record.status !== 'controlled') return false;

  record.status = 'grace';
  record.leaseExpiresAt = now + GRACE_DURATION_MS;
  record.controllerConnectionId = null;

  return true;
}

/** Reattach the controlling client during grace. Expired grace transitions
 * to uncontrolled and returns false. */
export function applyGraceReattach(
  record: ControllerRecord | undefined,
  clientId: string,
  connectionId: unknown,
  now: number,
): boolean {
  if (!record || record.status !== 'grace') return false;
  if (record.controllerClientId !== clientId) return false;

  if (record.leaseExpiresAt !== null && now > record.leaseExpiresAt) {
    applyGraceExpiry(record);
    return false;
  }

  record.status = 'controlled';
  record.controllerConnectionId = connectionId;
  record.lastHeartbeatAt = now;
  record.leaseExpiresAt = null;

  return true;
}

/** Expire the grace window back to uncontrolled. */
export function applyGraceExpiry(record: ControllerRecord): void {
  record.controllerClientId = null;
  record.controllerConnectionId = null;
  record.status = 'uncontrolled';
  record.acquiredAt = null;
  record.lastHeartbeatAt = null;
  record.leaseExpiresAt = null;
  record.pendingTakeover = null;
}

export function isGraceExpired(record: ControllerRecord, now: number): boolean {
  return (
    record.status === 'grace' &&
    record.leaseExpiresAt !== null &&
    now > record.leaseExpiresAt
  );
}

export type ControlActionResult =
  | { success: true; controlState: SessionControlState; transitionReason: SessionControlUpdateReason }
  | { success: false; error: string; code: string; controlState: SessionControlState };

export function applyClaim(
  record: ControllerRecord | undefined,
  sessionId: string,
  clientId: string | null,
  connectionId: unknown,
  now: number,
  autoClaimEligible: boolean,
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

  if (record.status === 'uncontrolled') {
    const previousStatus = record.status;
    applyAutoClaim(record, clientId, connectionId, now, autoClaimEligible);
    if (record.status !== previousStatus) {
      return {
        success: true,
        controlState: recordToState(record),
        transitionReason: 'claimed',
      };
    }
    return {
      success: false,
      error: 'Claim failed \u2014 client may not be eligible',
      code: 'not_eligible',
      controlState: recordToState(record),
    };
  }

  if (record.status === 'controlled' && record.controllerClientId === clientId) {
    return {
      success: true,
      controlState: recordToState(record),
      transitionReason: 'claimed',
    };
  }

  if (record.status === 'grace' && record.controllerClientId === clientId) {
    const reattached = applyGraceReattach(record, clientId, connectionId, now);
    if (reattached) {
      return {
        success: true,
        controlState: recordToState(record),
        transitionReason: 'grace_reattached',
      };
    }
  }

  return {
    success: false,
    error: record.status === 'controlled'
      ? 'Session is already controlled by another client'
      : record.status === 'grace'
        ? 'Session is in grace period for another client'
        : record.status === 'takeover_requested'
          ? 'A takeover request is already pending for this session'
          : 'Cannot claim control in current state',
    code: 'already_controlled',
    controlState: recordToState(record),
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
  record.lastHeartbeatAt = null;
  record.leaseExpiresAt = null;
  record.pendingTakeover = null;

  return {
    success: true,
    controlState: recordToState(record),
    transitionReason: 'released',
  };
}

export function applyRequestTakeover(
  record: ControllerRecord | undefined,
  sessionId: string,
  clientId: string | null,
  now: number,
  autoApprove: boolean,
): ControlActionResult {
  if (!clientId) {
    return {
      success: false,
      error: 'Client must be registered before requesting takeover',
      code: 'registration_required',
      controlState: record ? recordToState(record) : makeUncontrolledState(sessionId),
    };
  }

  if (!record) {
    return {
      success: false,
      error: 'No control record for this session',
      code: 'session_uncontrolled',
      controlState: makeUncontrolledState(sessionId),
    };
  }

  if (record.controllerClientId === clientId) {
    return {
      success: false,
      error: 'You already control this session',
      code: 'already_controller',
      controlState: recordToState(record),
    };
  }

  if (record.status !== 'controlled') {
    if (record.status === 'uncontrolled') {
      return {
        success: false,
        error: 'Session is uncontrolled \u2014 use claim instead',
        code: 'session_uncontrolled',
        controlState: recordToState(record),
      };
    }
    if (record.status === 'takeover_requested') {
      return {
        success: false,
        error: 'A takeover request is already pending for this session',
        code: 'takeover_pending',
        controlState: recordToState(record),
      };
    }
    return {
      success: false,
      error: `Cannot request takeover from status '${record.status}'`,
      code: 'invalid_state',
      controlState: recordToState(record),
    };
  }

  if (autoApprove) {
    record.controllerClientId = clientId;
    record.controllerConnectionId = null;
    record.acquiredAt = now;
    record.lastHeartbeatAt = now;
    record.leaseExpiresAt = null;
    record.status = 'controlled';
    record.pendingTakeover = null;

    return {
      success: true,
      controlState: recordToState(record),
      transitionReason: 'takeover_auto_approved',
    };
  }

  record.status = 'takeover_requested';
  record.pendingTakeover = {
    requestedByClientId: clientId,
    requestedAt: now,
  };

  return {
    success: true,
    controlState: recordToState(record),
    transitionReason: 'takeover_requested',
  };
}

export function applyRespondTakeover(
  record: ControllerRecord | undefined,
  sessionId: string,
  clientId: string | null,
  requesterClientId: string,
  decision: TakeoverDecision,
  now: number,
): ControlActionResult {
  if (!clientId) {
    return {
      success: false,
      error: 'Client must be registered before responding to takeover',
      code: 'registration_required',
      controlState: record ? recordToState(record) : makeUncontrolledState(sessionId),
    };
  }

  if (!record) {
    return {
      success: false,
      error: 'No control record for this session',
      code: 'session_uncontrolled',
      controlState: makeUncontrolledState(sessionId),
    };
  }

  if (record.controllerClientId !== clientId) {
    return {
      success: false,
      error: 'Only the current controller can respond to takeover requests',
      code: 'not_controller',
      controlState: recordToState(record),
    };
  }

  if (record.status !== 'takeover_requested') {
    return {
      success: false,
      error: 'No takeover request is pending for this session',
      code: 'no_takeover_pending',
      controlState: recordToState(record),
    };
  }

  if (!record.pendingTakeover || record.pendingTakeover.requestedByClientId !== requesterClientId) {
    return {
      success: false,
      error: 'Takeover request does not match the specified requester',
      code: 'takeover_mismatch',
      controlState: recordToState(record),
    };
  }

  if (decision === 'approve') {
    record.controllerClientId = requesterClientId;
    record.controllerConnectionId = null;
    record.acquiredAt = now;
    record.lastHeartbeatAt = now;
    record.leaseExpiresAt = null;
    record.status = 'controlled';
    record.pendingTakeover = null;

    return {
      success: true,
      controlState: recordToState(record),
      transitionReason: 'takeover_approved',
    };
  }

  record.status = 'controlled';
  record.pendingTakeover = null;

  return {
    success: true,
    controlState: recordToState(record),
    transitionReason: 'takeover_denied',
  };
}

/** Auto-approve the pending takeover (stale controller gone). */
export function applyTakeoverAutoApprove(record: ControllerRecord, now: number): boolean {
  if (!record.pendingTakeover) return false;

  record.controllerClientId = record.pendingTakeover.requestedByClientId;
  record.controllerConnectionId = null;
  record.acquiredAt = now;
  record.lastHeartbeatAt = now;
  record.leaseExpiresAt = null;
  record.status = 'controlled';
  record.pendingTakeover = null;

  return true;
}

export interface SessionResumeControlResult {
  controlState: SessionControlState;
  transitionReason: SessionControlUpdateReason | null;
}

/** Resume decision: grace reattach or auto-claim for the resuming client.
 * Participant bookkeeping stays in transport. */
export function applyResume(
  record: ControllerRecord,
  clientId: string | null,
  connectionId: unknown,
  now: number,
  autoClaimEligible: boolean,
): SessionResumeControlResult {
  let transitionReason: SessionControlUpdateReason | null = null;

  if (clientId) {
    if (record.status === 'grace' && record.controllerClientId === clientId) {
      const reattached = applyGraceReattach(record, clientId, connectionId, now);
      if (reattached) {
        transitionReason = 'grace_reattached';
      }
    } else if (record.status === 'uncontrolled') {
      const previousStatus = record.status;
      applyAutoClaim(record, clientId, connectionId, now, autoClaimEligible);
      if (record.status !== previousStatus) {
        transitionReason = 'auto_claimed';
      }
    }
  }

  return {
    controlState: recordToState(record),
    transitionReason,
  };
}

export type StaleTakeoverDecision = 'clear_denied' | 'auto_approve' | null;

/** Stale takeover decision: requests older than the timeout clear back to
 * controlled when the controller is still connected, or auto-approve when
 * the controller is gone. */
export function decideStaleTakeover(
  record: ControllerRecord,
  now: number,
  controllerHasActiveConnections: boolean,
): StaleTakeoverDecision {
  if (
    record.status === 'takeover_requested' &&
    record.pendingTakeover &&
    now - record.pendingTakeover.requestedAt > TAKEOVER_REQUEST_TIMEOUT_MS
  ) {
    return controllerHasActiveConnections ? 'clear_denied' : 'auto_approve';
  }
  return null;
}

export type DisconnectDecision = 'grace' | 'takeover_auto_approved' | null;

/** Disconnect decision for the session when the disconnecting client was
 * the controller: enter grace, or auto-approve a pending takeover. */
export function decideDisconnectTransition(
  record: ControllerRecord | undefined,
  clientId: string,
): DisconnectDecision {
  if (!record || record.controllerClientId !== clientId) return null;
  if (record.status === 'controlled') return 'grace';
  if (record.status === 'takeover_requested') return 'takeover_auto_approved';
  return null;
}
