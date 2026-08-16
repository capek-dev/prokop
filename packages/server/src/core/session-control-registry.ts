/**
 * Temporary forwarding module (S2).
 *
 * The controller registry now lives in `transport/websocket/control-registry`
 * and resolves connections by opaque ConnectionId. This module keeps the old
 * socket-based signatures working until consumers migrate.
 */
import {
  addParticipant,
  removeParticipant,
  getSessionParticipants,
  getParticipantClientIds,
  getControlState,
  isControlled,
  isController,
  isControllingClient,
  isEligibleForAutoClaim,
  tryAutoClaim,
  enterGrace,
  tryReattachDuringGrace,
  expireGrace,
  clearStaleTakeoverRequests,
  sweepExpiredGrace,
  removeSessionControl,
  buildControlUpdatedMessage,
  getControlRecordCount,
  getAllControlRecords,
  getParticipantConnections,
  getControllerConnections,
  type SessionControlRecord,
  type SessionParticipantEntry,
  type ControllerGateRejection,
  type ControlActionResult,
  type StaleTakeoverResult,
  type SessionResumeControlResult,
  type DisconnectTransition,
} from '@/transport/websocket/control-registry';
import {
  handleClaim as transportHandleClaim,
  handleRelease as transportHandleRelease,
  handleRequestTakeover as transportHandleRequestTakeover,
  handleRespondTakeover as transportHandleRespondTakeover,
  handleSessionResume as transportHandleSessionResume,
  handleConnectionDisconnect as transportHandleConnectionDisconnect,
  checkControllerGate as transportCheckControllerGate,
  isControllerConnection as transportIsControllerConnection,
} from '@/transport/websocket/control-registry';
import { getConnectionByWs } from './client-registry';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import type { ControllerGatedAction, TakeoverDecision } from '@jean2/sdk';

export {
  addParticipant,
  removeParticipant,
  getSessionParticipants,
  getParticipantClientIds,
  getControlState,
  isControlled,
  isController,
  isControllingClient,
  isEligibleForAutoClaim,
  tryAutoClaim,
  enterGrace,
  tryReattachDuringGrace,
  expireGrace,
  clearStaleTakeoverRequests,
  sweepExpiredGrace,
  removeSessionControl,
  buildControlUpdatedMessage,
  getControlRecordCount,
  getAllControlRecords,
  getParticipantConnections,
  getControllerConnections,
  type SessionControlRecord,
  type SessionParticipantEntry,
  type ControllerGateRejection,
  type ControlActionResult,
  type StaleTakeoverResult,
  type SessionResumeControlResult,
  type DisconnectTransition,
};

function connectionIdFor(ws: unknown): ConnectionId {
  return (getConnectionByWs(ws)?.connectionId ?? null) as ConnectionId;
}

export function isControllerConnection(sessionId: string, ws: unknown): boolean {
  return transportIsControllerConnection(sessionId, connectionIdFor(ws));
}

export function checkControllerGate(
  sessionId: string,
  action: ControllerGatedAction,
  ws: unknown,
): ControllerGateRejection | null {
  return transportCheckControllerGate(sessionId, action, connectionIdFor(ws));
}

export function handleClaim(sessionId: string, ws: unknown): ControlActionResult {
  return transportHandleClaim(sessionId, connectionIdFor(ws));
}

export function handleRelease(sessionId: string, ws: unknown): ControlActionResult {
  return transportHandleRelease(sessionId, connectionIdFor(ws));
}

export function handleRequestTakeover(
  sessionId: string,
  ws: unknown,
  autoApprove = false,
): ControlActionResult {
  return transportHandleRequestTakeover(sessionId, connectionIdFor(ws), autoApprove);
}

export function handleRespondTakeover(
  sessionId: string,
  ws: unknown,
  requesterClientId: string,
  decision: TakeoverDecision,
): ControlActionResult {
  return transportHandleRespondTakeover(sessionId, connectionIdFor(ws), requesterClientId, decision);
}

export function handleSessionResume(
  sessionId: string,
  ws: unknown,
): SessionResumeControlResult {
  return transportHandleSessionResume(sessionId, connectionIdFor(ws));
}

export function handleConnectionDisconnect(ws: unknown): DisconnectTransition[] {
  return transportHandleConnectionDisconnect(connectionIdFor(ws));
}
