import type {
  ControllerGatedAction,
  ServerMessage,
  SessionControlState,
  SessionControlUpdateReason,
} from '@prokopai/sdk';
import {
  applyClaim,
  applyRelease,
  applyResume,
  decideControllerGate,
  isAutoClaimEligible,
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
 * Transport controller registry. The controller and participant
 * registries, connection lookups, and console logs stay here; every
 * claim/release/gate decision is delegated to the named controller
 * domain through the application port layer.
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

// Auto-claim eligibility

export function isEligibleForAutoClaim(clientId: string): boolean {
  const client = getClientByClientId(clientId);
  if (!client) return false;
  return isAutoClaimEligible(client.interactionMode);
}

// Control action handlers

export function handleClaim(
  sessionId: string,
  connectionId: ConnectionId,
): ControlActionResult {
  const conn = getConnectionById(connectionId);
  const clientId = conn?.clientId ?? null;
  const record = clientId ? ensureControlRecord(sessionId) : controlBySessionId.get(sessionId);
  const previousController = record?.controllerClientId ?? null;

  const result = applyClaim(record, sessionId, clientId, connectionId, Date.now());

  if (result.success) {
    console.log(
      `[control] Claim: clientId=${clientId} previousController=${previousController} sessionId=${sessionId} connectionId=${connectionId}`,
    );
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

  if (result.transitionReason === 'auto_claimed') {
    console.log(
      `[control] Auto-claim: clientId=${clientId} sessionId=${sessionId} connectionId=${connectionId}`,
    );
  }

  return result;
}

// Disconnect cleanup: control never changes on disconnect, only
// participant bookkeeping is updated.

export function handleConnectionDisconnect(connectionId: ConnectionId): void {
  const conn = getConnectionById(connectionId);
  if (!conn) return;

  const { clientId, activeSessionIds } = conn;

  if (clientId) {
    for (const activeSessionId of activeSessionIds) {
      removeParticipant(activeSessionId, connectionId, clientId);
    }

    // Secondary cleanup: remove participant entries from ALL sessions
    // (covers any sessions that might not be in activeSessionIds)
    controlBySessionId.forEach((_record, sessionId) => {
      if (!activeSessionIds.has(sessionId)) {
        removeParticipant(sessionId, connectionId, clientId);
      }
    });
  }
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
