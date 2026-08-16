import type { SessionControlState, SessionControlStatus, SessionControlUpdateReason, TakeoverDecision, ControllerGatedAction, ServerMessage } from '@jean2/sdk';
import { getConnectionById, getClientIdForConnection, getClientByClientId, getConnectionsForClient, type RegisteredConnection } from './connection-registry';
import type { ConnectionId } from './connection-id';

// Constants

const GRACE_DURATION_MS = 15_000;

// Types

export interface SessionControlRecord {
  sessionId: string;
  controllerClientId: string | null;
  controllerConnectionId: ConnectionId | null;
  status: SessionControlStatus;
  acquiredAt: number | null;
  lastHeartbeatAt: number | null;
  leaseExpiresAt: number | null;
  pendingTakeover: {
    requestedByClientId: string;
    requestedAt: number;
  } | null;
}

export interface SessionParticipantEntry {
  clientId: string;
  connectionIds: Set<ConnectionId>;
}

// Registries

const controlBySessionId = new Map<string, SessionControlRecord>();
const participantsBySessionId = new Map<string, Map<string, SessionParticipantEntry>>();

// Control state helpers

function makeUncontrolledState(sessionId: string): SessionControlState {
  return {
    sessionId,
    controllerClientId: null,
    controllerConnectionId: null,
    acquiredAt: null,
    lastHeartbeatAt: null,
    leaseExpiresAt: null,
    status: 'uncontrolled',
    pendingTakeover: null,
  };
}

function recordToState(record: SessionControlRecord): SessionControlState {
  return {
    sessionId: record.sessionId,
    controllerClientId: record.controllerClientId,
    controllerConnectionId: record.controllerConnectionId,
    acquiredAt: record.acquiredAt,
    lastHeartbeatAt: record.lastHeartbeatAt,
    leaseExpiresAt: record.leaseExpiresAt,
    status: record.status,
    pendingTakeover: record.pendingTakeover,
  };
}

// Participant management

export function addParticipant(sessionId: string, connectionId: ConnectionId, clientId: string): void {
  let participants = participantsBySessionId.get(sessionId);
  if (!participants) {
    participants = new Map();
    participantsBySessionId.set(sessionId, participants);
  }

  let entry = participants.get(clientId);
  if (!entry) {
    entry = { clientId, connectionIds: new Set() };
    participants.set(clientId, entry);
  }
  entry.connectionIds.add(connectionId);
}

export function removeParticipant(sessionId: string, connectionId: ConnectionId, clientId: string): void {
  const participants = participantsBySessionId.get(sessionId);
  if (!participants) return;

  const entry = participants.get(clientId);
  if (!entry) return;

  entry.connectionIds.delete(connectionId);
  if (entry.connectionIds.size === 0) {
    participants.delete(clientId);
  }

  if (participants.size === 0) {
    participantsBySessionId.delete(sessionId);
  }
}

export function getSessionParticipants(sessionId: string): SessionParticipantEntry[] {
  const participants = participantsBySessionId.get(sessionId);
  if (!participants) return [];
  return Array.from(participants.values());
}

export function getParticipantClientIds(sessionId: string): string[] {
  const participants = participantsBySessionId.get(sessionId);
  if (!participants) return [];
  return Array.from(participants.keys());
}

// Control registry

function ensureControlRecord(sessionId: string): SessionControlRecord {
  let record = controlBySessionId.get(sessionId);
  if (!record) {
    record = {
      sessionId,
      controllerClientId: null,
      controllerConnectionId: null,
      status: 'uncontrolled',
      acquiredAt: null,
      lastHeartbeatAt: null,
      leaseExpiresAt: null,
      pendingTakeover: null,
    };
    controlBySessionId.set(sessionId, record);
  }
  return record;
}

export function getControlState(sessionId: string): SessionControlState {
  const record = controlBySessionId.get(sessionId);
  if (!record) return makeUncontrolledState(sessionId);
  return recordToState(record);
}

export function isControlled(sessionId: string): boolean {
  const record = controlBySessionId.get(sessionId);
  return record?.status === 'controlled' && record.controllerClientId !== null;
}

export function isController(sessionId: string, clientId: string): boolean {
  const record = controlBySessionId.get(sessionId);
  return record?.controllerClientId === clientId && record?.status === 'controlled';
}

export function isControllingClient(sessionId: string, clientId: string): boolean {
  const record = controlBySessionId.get(sessionId);
  return record?.controllerClientId === clientId;
}

export function isControllerConnection(sessionId: string, connectionId: ConnectionId): boolean {
  const clientId = getClientIdForConnection(connectionId);
  if (!clientId) return false;
  return isController(sessionId, clientId);
}

// Controller gate

export interface ControllerGateRejection {
  sessionId: string;
  action: ControllerGatedAction;
  code: 'not_controller' | 'session_uncontrolled' | 'registration_required';
  message: string;
  control: SessionControlState;
}

export function checkControllerGate(
  sessionId: string,
  action: ControllerGatedAction,
  connectionId: ConnectionId,
): ControllerGateRejection | null {
  const record = controlBySessionId.get(sessionId);

  if (!record || record.status === 'uncontrolled') {
    return null;
  }

  const clientId = getClientIdForConnection(connectionId);
  if (!clientId) {
    return {
      sessionId,
      action,
      code: 'registration_required',
      message: 'Client must be registered to perform this action',
      control: getControlState(sessionId),
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
    control: getControlState(sessionId),
  };
}

// Auto-claim

export function isEligibleForAutoClaim(clientId: string): boolean {
  const client = getClientByClientId(clientId);
  if (!client) return false;
  return client.interactionMode === 'human' || client.interactionMode === 'hybrid';
}

export function tryAutoClaim(
  sessionId: string,
  clientId: string,
  connectionId: ConnectionId,
): SessionControlState {
  const record = ensureControlRecord(sessionId);

  if (record.status !== 'uncontrolled') {
    return recordToState(record);
  }

  if (!isEligibleForAutoClaim(clientId)) {
    return recordToState(record);
  }

  const now = Date.now();
  record.controllerClientId = clientId;
  record.controllerConnectionId = connectionId;
  record.status = 'controlled';
  record.acquiredAt = now;
  record.lastHeartbeatAt = now;
  record.leaseExpiresAt = null;
  record.pendingTakeover = null;

  console.log(
    `[control] Auto-claim: clientId=${clientId} sessionId=${sessionId} connectionId=${connectionId}`,
  );

  return recordToState(record);
}

// Grace management

export function enterGrace(sessionId: string): void {
  const record = controlBySessionId.get(sessionId);
  if (!record) return;
  if (record.status !== 'controlled') return;

  const now = Date.now();
  record.status = 'grace';
  record.leaseExpiresAt = now + GRACE_DURATION_MS;
  record.controllerConnectionId = null;

  console.log(
    `[control] Grace entered: sessionId=${sessionId} controllerClientId=${record.controllerClientId} expiresAt=${record.leaseExpiresAt}`,
  );
}

export function tryReattachDuringGrace(
  sessionId: string,
  clientId: string,
  connectionId: ConnectionId,
): boolean {
  const record = controlBySessionId.get(sessionId);
  if (!record) return false;
  if (record.status !== 'grace') return false;
  if (record.controllerClientId !== clientId) return false;

  const now = Date.now();
  if (record.leaseExpiresAt !== null && now > record.leaseExpiresAt) {
    expireGrace(sessionId);
    return false;
  }

  record.status = 'controlled';
  record.controllerConnectionId = connectionId;
  record.lastHeartbeatAt = now;
  record.leaseExpiresAt = null;

  console.log(
    `[control] Grace reattach: clientId=${clientId} sessionId=${sessionId} connectionId=${connectionId}`,
  );

  return true;
}

export function expireGrace(sessionId: string): void {
  const record = controlBySessionId.get(sessionId);
  if (!record) return;
  if (record.status !== 'grace') return;

  console.log(
    `[control] Grace expired: sessionId=${sessionId} previousController=${record.controllerClientId}`,
  );

  record.controllerClientId = null;
  record.controllerConnectionId = null;
  record.status = 'uncontrolled';
  record.acquiredAt = null;
  record.lastHeartbeatAt = null;
  record.leaseExpiresAt = null;
  record.pendingTakeover = null;
}

// Control action handlers

export type ControlActionResult =
  | { success: true; controlState: SessionControlState; transitionReason: SessionControlUpdateReason }
  | { success: false; error: string; code: string; controlState: SessionControlState };

export function handleClaim(
  sessionId: string,
  connectionId: ConnectionId,
): ControlActionResult {
  const conn = getConnectionById(connectionId);
  const clientId = conn?.clientId ?? null;

  if (!clientId) {
    return {
      success: false,
      error: 'Client must be registered before claiming control',
      code: 'registration_required',
      controlState: getControlState(sessionId),
    };
  }

  const record = ensureControlRecord(sessionId);

  if (record.status === 'uncontrolled') {
    const previousStatus = record.status;
    tryAutoClaim(sessionId, clientId, connectionId);
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
    const reattached = tryReattachDuringGrace(sessionId, clientId, connectionId);
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

export function handleRelease(
  sessionId: string,
  connectionId: ConnectionId,
): ControlActionResult {
  const conn = getConnectionById(connectionId);
  const clientId = conn?.clientId ?? null;

  if (!clientId) {
    return {
      success: false,
      error: 'Client must be registered before releasing control',
      code: 'registration_required',
      controlState: getControlState(sessionId),
    };
  }

  const record = controlBySessionId.get(sessionId);
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

  console.log(
    `[control] Release: clientId=${clientId} sessionId=${sessionId}`,
  );

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

export function handleRequestTakeover(
  sessionId: string,
  connectionId: ConnectionId,
  autoApprove = false,
): ControlActionResult {
  const conn = getConnectionById(connectionId);
  const clientId = conn?.clientId ?? null;

  if (!clientId) {
    return {
      success: false,
      error: 'Client must be registered before requesting takeover',
      code: 'registration_required',
      controlState: getControlState(sessionId),
    };
  }

  const record = controlBySessionId.get(sessionId);
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

  const now = Date.now();

  if (autoApprove) {
    console.log(
      `[control] Takeover auto-approved (env): newController=${clientId} previousController=${record.controllerClientId} sessionId=${sessionId}`,
    );

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

  console.log(
    `[control] Takeover requested: requesterClientId=${clientId} sessionId=${sessionId} controllerClientId=${record.controllerClientId}`,
  );

  return {
    success: true,
    controlState: recordToState(record),
    transitionReason: 'takeover_requested',
  };
}

export function handleRespondTakeover(
  sessionId: string,
  connectionId: ConnectionId,
  requesterClientId: string,
  decision: TakeoverDecision,
): ControlActionResult {
  const conn = getConnectionById(connectionId);
  const clientId = conn?.clientId ?? null;

  if (!clientId) {
    return {
      success: false,
      error: 'Client must be registered before responding to takeover',
      code: 'registration_required',
      controlState: getControlState(sessionId),
    };
  }

  const record = controlBySessionId.get(sessionId);
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

  const now = Date.now();

  if (decision === 'approve') {
    console.log(
      `[control] Takeover approved: newController=${requesterClientId} previousController=${clientId} sessionId=${sessionId}`,
    );

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

  console.log(
    `[control] Takeover denied: requesterClientId=${requesterClientId} controllerClientId=${clientId} sessionId=${sessionId}`,
  );

  record.status = 'controlled';
  record.pendingTakeover = null;

  return {
    success: true,
    controlState: recordToState(record),
    transitionReason: 'takeover_denied',
  };
}

// Stale takeover cleanup

const TAKEOVER_REQUEST_TIMEOUT_MS = 60_000;

export interface StaleTakeoverResult {
  sessionId: string;
  reason: SessionControlUpdateReason;
}

export function clearStaleTakeoverRequests(): StaleTakeoverResult[] {
  const now = Date.now();
  const results: StaleTakeoverResult[] = [];

  controlBySessionId.forEach((record, sessionId) => {
    if (
      record.status === 'takeover_requested' &&
      record.pendingTakeover &&
      now - record.pendingTakeover.requestedAt > TAKEOVER_REQUEST_TIMEOUT_MS
    ) {
      if (clientHasActiveConnections(record.controllerClientId ?? '')) {
        console.log(
          `[control] Stale takeover cleared (controller alive): sessionId=${sessionId} requester=${record.pendingTakeover.requestedByClientId}`,
        );

        record.status = 'controlled';
        record.pendingTakeover = null;
        results.push({ sessionId, reason: 'takeover_denied' });
      } else {
        console.log(
          `[control] Stale takeover cleared (controller gone): sessionId=${sessionId} requester=${record.pendingTakeover.requestedByClientId}`,
        );

        autoApproveTakeover(sessionId);
        results.push({ sessionId, reason: 'takeover_auto_approved' });
      }
    }
  });

  return results;
}

// Auto-approve takeover

function autoApproveTakeover(sessionId: string): void {
  const record = controlBySessionId.get(sessionId);
  if (!record?.pendingTakeover) return;

  const now = Date.now();
  const newControllerClientId = record.pendingTakeover.requestedByClientId;

  console.log(
    `[control] Takeover auto-approved: newController=${newControllerClientId} previousController=${record.controllerClientId} sessionId=${sessionId}`,
  );

  record.controllerClientId = newControllerClientId;
  record.controllerConnectionId = null;
  record.acquiredAt = now;
  record.lastHeartbeatAt = now;
  record.leaseExpiresAt = null;
  record.status = 'controlled';
  record.pendingTakeover = null;
}

// Session resume integration

export interface SessionResumeControlResult {
  controlState: SessionControlState;
  transitionReason: SessionControlUpdateReason | null;
}

export function handleSessionResume(
  sessionId: string,
  connectionId: ConnectionId,
): SessionResumeControlResult {
  const conn = getConnectionById(connectionId);
  const clientId = conn?.clientId ?? null;

  addParticipant(sessionId, connectionId, clientId ?? '');
  if (conn) {
    conn.activeSessionIds.add(sessionId);
  }

  const record = ensureControlRecord(sessionId);
  let transitionReason: SessionControlUpdateReason | null = null;

  if (clientId) {
    if (record.status === 'grace' && record.controllerClientId === clientId) {
      const reattached = tryReattachDuringGrace(sessionId, clientId, connectionId);
      if (reattached) {
        transitionReason = 'grace_reattached';
      }
    } else if (record.status === 'uncontrolled') {
      const previousStatus = record.status;
      tryAutoClaim(sessionId, clientId, connectionId);
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

// Disconnect cleanup

export interface DisconnectTransition {
  sessionId: string;
  reason: SessionControlUpdateReason;
}

function clientHasActiveConnections(clientId: string): boolean {
  return getConnectionsForClient(clientId).length > 0;
}

export function handleConnectionDisconnect(connectionId: ConnectionId): DisconnectTransition[] {
  const conn = getConnectionById(connectionId);
  if (!conn) return [];

  const { clientId, activeSessionIds } = conn;
  const transitions: DisconnectTransition[] = [];

  // Process grace/takeover for every session this connection was participating in
  for (const activeSessionId of activeSessionIds) {
    if (clientId) {
      removeParticipant(activeSessionId, connectionId, clientId);

      const participants = participantsBySessionId.get(activeSessionId);
      const clientEntry = participants?.get(clientId);
      if (!clientEntry || clientEntry.connectionIds.size === 0) {
        if (isController(activeSessionId, clientId)) {
          enterGrace(activeSessionId);
          transitions.push({ sessionId: activeSessionId, reason: 'grace_entered' });
        } else if (isControllingClient(activeSessionId, clientId)) {
          const record = controlBySessionId.get(activeSessionId);
          if (record?.status === 'takeover_requested') {
            autoApproveTakeover(activeSessionId);
            transitions.push({ sessionId: activeSessionId, reason: 'takeover_auto_approved' });
          }
        }
      }
    }
  }

  // Secondary cleanup: remove participant entries from ALL sessions
  // (covers any sessions that might not be in activeSessionIds)
  controlBySessionId.forEach((_record, sessionId) => {
    if (!activeSessionIds.has(sessionId) && clientId) {
      removeParticipant(sessionId, connectionId, clientId);
    }
  });

  return transitions;
}

// Periodic grace expiry sweep

export function sweepExpiredGrace(): string[] {
  const now = Date.now();
  const expired: string[] = [];

  controlBySessionId.forEach((record, sessionId) => {
    if (
      record.status === 'grace' &&
      record.leaseExpiresAt !== null &&
      now > record.leaseExpiresAt
    ) {
      expireGrace(sessionId);
      expired.push(sessionId);
    }
  });

  return expired;
}

// Session cleanup

export function removeSessionControl(sessionId: string): void {
  controlBySessionId.delete(sessionId);
  participantsBySessionId.delete(sessionId);
}

// Broadcast helper

export function buildControlUpdatedMessage(
  sessionId: string,
  reason: SessionControlUpdateReason,
): ServerMessage {
  return {
    type: 'session.control.updated',
    control: getControlState(sessionId),
    reason,
  };
}

// Debug / introspection

export function getControlRecordCount(): number {
  return controlBySessionId.size;
}

export function getAllControlRecords(): ReadonlyMap<string, SessionControlRecord> {
  return controlBySessionId;
}

// Delivery helpers

export function getParticipantConnections(sessionId: string): RegisteredConnection[] {
  const participants = participantsBySessionId.get(sessionId);
  if (!participants) return [];
  const result: RegisteredConnection[] = [];
  for (const entry of participants.values()) {
    for (const connId of entry.connectionIds) {
      const conn = getConnectionById(connId);
      if (conn) result.push(conn);
    }
  }
  return result;
}

export function getControllerConnections(sessionId: string): RegisteredConnection[] {
  const record = controlBySessionId.get(sessionId);
  if (!record?.controllerClientId) return [];
  return getConnectionsForClient(record.controllerClientId);
}
