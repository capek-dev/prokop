import type {
  ControllerGatedAction,
  ServerMessage,
  SessionControlState,
  SessionControlUpdateReason,
  TakeoverDecision,
} from '@prokopai/sdk';
import {
  applyAutoClaim,
  applyClaim,
  applyGraceEntry,
  applyGraceExpiry,
  applyGraceReattach,
  applyRelease,
  applyRequestTakeover,
  applyRespondTakeover,
  applyResume,
  applyTakeoverAutoApprove,
  decideControllerGate,
  decideDisconnectTransition,
  decideStaleTakeover,
  isAutoClaimEligible,
  isGraceExpired,
  makeUncontrolledRecord,
  recordToState,
  type ControllerGateRejection,
  type ControlActionResult,
  type ControllerRecord,
  type SessionResumeControlResult,
} from '@/application/ports/control';
import { getConnectionById, getClientIdForConnection, getClientByClientId, getConnectionsForClient, type RegisteredConnection } from './connection-registry';
import type { ConnectionId } from './connection-id';

/**
 * Transport controller registry (S4). The controller and participant
 * registries, connection lookups, console logs, and sweep scheduling stay
 * here; every claim/release/takeover/gate/grace decision is delegated to
 * the named controller domain through the application port layer.
 */

// Types

export type SessionControlRecord = ControllerRecord;

export interface SessionParticipantEntry {
  clientId: string;
  connectionIds: Set<ConnectionId>;
}

export type { ControllerGateRejection, ControlActionResult, SessionResumeControlResult };

// Registries

const controlBySessionId = new Map<string, ControllerRecord>();
const participantsBySessionId = new Map<string, Map<string, SessionParticipantEntry>>();

// Control state helpers

function makeUncontrolledState(sessionId: string): SessionControlState {
  return recordToState(makeUncontrolledRecord(sessionId));
}

function ensureControlRecord(sessionId: string): ControllerRecord {
  let record = controlBySessionId.get(sessionId);
  if (!record) {
    record = makeUncontrolledRecord(sessionId);
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

// Controller gate

export function checkControllerGate(
  sessionId: string,
  action: ControllerGatedAction,
  connectionId: ConnectionId,
): ControllerGateRejection | null {
  const record = controlBySessionId.get(sessionId);
  const clientId = getClientIdForConnection(connectionId);
  return decideControllerGate(record, clientId, sessionId, action);
}

// Auto-claim

export function isEligibleForAutoClaim(clientId: string): boolean {
  const client = getClientByClientId(clientId);
  if (!client) return false;
  return isAutoClaimEligible(client.interactionMode);
}

export function tryAutoClaim(
  sessionId: string,
  clientId: string,
  connectionId: ConnectionId,
): SessionControlState {
  const record = ensureControlRecord(sessionId);
  const eligible = isEligibleForAutoClaim(clientId);
  const previousStatus = record.status;

  const state = applyAutoClaim(record, clientId, connectionId, Date.now(), eligible);

  if (record.status !== previousStatus) {
    console.log(
      `[control] Auto-claim: clientId=${clientId} sessionId=${sessionId} connectionId=${connectionId}`,
    );
  }

  return state;
}

// Grace management

export function enterGrace(sessionId: string): void {
  const record = controlBySessionId.get(sessionId);
  const now = Date.now();
  const entered = applyGraceEntry(record, now);
  if (!entered || !record) return;

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
  const reattached = applyGraceReattach(record, clientId, connectionId, Date.now());
  if (!reattached || !record) return false;

  console.log(
    `[control] Grace reattach: clientId=${clientId} sessionId=${sessionId} connectionId=${connectionId}`,
  );

  return true;
}

export function expireGrace(sessionId: string): void {
  const record = controlBySessionId.get(sessionId);
  if (!record) return;

  console.log(
    `[control] Grace expired: sessionId=${sessionId} previousController=${record.controllerClientId}`,
  );

  applyGraceExpiry(record);
}

// Control action handlers

export function handleClaim(
  sessionId: string,
  connectionId: ConnectionId,
): ControlActionResult {
  const conn = getConnectionById(connectionId);
  const clientId = conn?.clientId ?? null;
  const eligible = clientId ? isEligibleForAutoClaim(clientId) : false;
  const record = clientId ? ensureControlRecord(sessionId) : controlBySessionId.get(sessionId);
  const wasUncontrolled = record?.status === 'uncontrolled';

  const result = applyClaim(record, sessionId, clientId, connectionId, Date.now(), eligible);

  if (result.success) {
    if (result.transitionReason === 'claimed' && wasUncontrolled) {
      console.log(
        `[control] Auto-claim: clientId=${clientId} sessionId=${sessionId} connectionId=${connectionId}`,
      );
    } else if (result.transitionReason === 'grace_reattached') {
      console.log(
        `[control] Grace reattach: clientId=${clientId} sessionId=${sessionId} connectionId=${connectionId}`,
      );
    }
  }

  return result;
}

export function handleRelease(
  sessionId: string,
  connectionId: ConnectionId,
): ControlActionResult {
  const conn = getConnectionById(connectionId);
  const clientId = conn?.clientId ?? null;
  const record = controlBySessionId.get(sessionId);

  const result = applyRelease(record, sessionId, clientId);

  if (result.success) {
    console.log(
      `[control] Release: clientId=${clientId} sessionId=${sessionId}`,
    );
  }

  return result;
}

export function handleRequestTakeover(
  sessionId: string,
  connectionId: ConnectionId,
  autoApprove = false,
): ControlActionResult {
  const conn = getConnectionById(connectionId);
  const clientId = conn?.clientId ?? null;
  const record = controlBySessionId.get(sessionId);
  const previousController = record?.controllerClientId ?? null;

  const result = applyRequestTakeover(record, sessionId, clientId, Date.now(), autoApprove);

  if (result.success && result.transitionReason === 'takeover_auto_approved') {
    console.log(
      `[control] Takeover auto-approved (env): newController=${clientId} previousController=${previousController} sessionId=${sessionId}`,
    );
  } else if (result.success && result.transitionReason === 'takeover_requested') {
    console.log(
      `[control] Takeover requested: requesterClientId=${clientId} sessionId=${sessionId} controllerClientId=${previousController}`,
    );
  }

  return result;
}

export function handleRespondTakeover(
  sessionId: string,
  connectionId: ConnectionId,
  requesterClientId: string,
  decision: TakeoverDecision,
): ControlActionResult {
  const conn = getConnectionById(connectionId);
  const clientId = conn?.clientId ?? null;
  const record = controlBySessionId.get(sessionId);

  const result = applyRespondTakeover(record, sessionId, clientId, requesterClientId, decision, Date.now());

  if (result.success && result.transitionReason === 'takeover_approved') {
    console.log(
      `[control] Takeover approved: newController=${requesterClientId} previousController=${clientId} sessionId=${sessionId}`,
    );
  } else if (result.success && result.transitionReason === 'takeover_denied') {
    console.log(
      `[control] Takeover denied: requesterClientId=${requesterClientId} controllerClientId=${clientId} sessionId=${sessionId}`,
    );
  }

  return result;
}

// Stale takeover cleanup

export interface StaleTakeoverResult {
  sessionId: string;
  reason: SessionControlUpdateReason;
}

export function clearStaleTakeoverRequests(): StaleTakeoverResult[] {
  const now = Date.now();
  const results: StaleTakeoverResult[] = [];

  controlBySessionId.forEach((record, sessionId) => {
    const controllerAlive = clientHasActiveConnections(record.controllerClientId ?? '');
    const decision = decideStaleTakeover(record, now, controllerAlive);
    if (decision === null) return;

    const requester = record.pendingTakeover?.requestedByClientId;
    if (decision === 'clear_denied') {
      console.log(
        `[control] Stale takeover cleared (controller alive): sessionId=${sessionId} requester=${requester}`,
      );
      record.status = 'controlled';
      record.pendingTakeover = null;
      results.push({ sessionId, reason: 'takeover_denied' });
    } else {
      console.log(
        `[control] Stale takeover cleared (controller gone): sessionId=${sessionId} requester=${requester}`,
      );
      const previousController = record.controllerClientId;
      applyTakeoverAutoApprove(record, now);
      console.log(
        `[control] Takeover auto-approved: newController=${record.controllerClientId} previousController=${previousController} sessionId=${sessionId}`,
      );
      results.push({ sessionId, reason: 'takeover_auto_approved' });
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
  const previousController = record.controllerClientId;

  applyTakeoverAutoApprove(record, now);

  console.log(
    `[control] Takeover auto-approved: newController=${newControllerClientId} previousController=${previousController} sessionId=${sessionId}`,
  );
}

// Session resume integration

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
  const eligible = clientId ? isEligibleForAutoClaim(clientId) : false;
  const result = applyResume(record, clientId, connectionId, Date.now(), eligible);

  if (result.transitionReason === 'grace_reattached') {
    console.log(
      `[control] Grace reattach: clientId=${clientId} sessionId=${sessionId} connectionId=${connectionId}`,
    );
  } else if (result.transitionReason === 'auto_claimed') {
    console.log(
      `[control] Auto-claim: clientId=${clientId} sessionId=${sessionId} connectionId=${connectionId}`,
    );
  }

  return result;
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

  for (const activeSessionId of activeSessionIds) {
    if (clientId) {
      removeParticipant(activeSessionId, connectionId, clientId);

      const participants = participantsBySessionId.get(activeSessionId);
      const clientEntry = participants?.get(clientId);
      if (!clientEntry || clientEntry.connectionIds.size === 0) {
        const record = controlBySessionId.get(activeSessionId);
        const decision = decideDisconnectTransition(record, clientId);
        if (decision === 'grace') {
          enterGrace(activeSessionId);
          transitions.push({ sessionId: activeSessionId, reason: 'grace_entered' });
        } else if (decision === 'takeover_auto_approved') {
          autoApproveTakeover(activeSessionId);
          transitions.push({ sessionId: activeSessionId, reason: 'takeover_auto_approved' });
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
    if (isGraceExpired(record, now)) {
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
