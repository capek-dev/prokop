import type { AskAuthority, ClientCapability } from '@jean2/sdk';
import { getClientByClientId, getConnectionsForClient, getAllClients } from './client-registry';
import {
  getParticipantClientIds,
  getControllerConnections,
  getParticipantConnections,
} from './session-control-registry';
import type { RegisteredConnection } from './client-registry';
import type { ServerMessage } from '@jean2/sdk';
import {
  carrierHasCapabilities,
  checkAskResponseEligibility as checkAskResponseEligibilityWithInput,
  getEligibleResponderClientIds as getEligibleResponderClientIdsFromInventories,
  isAllowedResponder as isAllowedResponderForClient,
  resolveAskDeliveryTargets as resolveAskDeliveryTargetsFromInventories,
  type AskDeliveryInventories,
  type AskDeliveryTargets as DomainAskDeliveryTargets,
  type EligibilityCheck,
} from '@/domains/controllers';

// =============================================================================
// Capability Router (compatibility module, S4)
//
// The ask response eligibility and delivery target policy moved to the
// controller domain (`domains/controllers/ask-routing.ts`). This module
// keeps the pre-S4 export identities as registry-bound wrappers: it builds
// the inventories from the client and session-control registries and
// delegates every decision to the domain.
//
// Resolution modes:
// - controller_only:    Only the current controller can respond (Phase 5 default)
// - designated_clients: Only clients listed in allowedResponderClientIds can respond
// - first_eligible:     First connected client with matching capabilities can respond
//
// Visibility scopes:
// - controller_only:      Ask delivered only to controller's connections
// - session_participants: Ask delivered to all session participants' connections
// =============================================================================

// ── Capability matching ──────────────────────────────────────

/**
 * Check if a client has all the required capabilities.
 * Returns true if the client has every capability in the required list.
 * If requiredCapabilities is empty or undefined, any client passes.
 */
export function clientHasCapabilities(
  clientId: string,
  requiredCapabilities?: ClientCapability[],
): boolean {
  if (!requiredCapabilities || requiredCapabilities.length === 0) {
    return true;
  }

  const client = getClientByClientId(clientId);
  if (!client) return false;

  return carrierHasCapabilities(client, requiredCapabilities);
}

/**
 * Check if a clientId is in the allowed responders list.
 * Returns true if allowedResponderClientIds is empty or undefined.
 */
export function isAllowedResponder(
  clientId: string,
  allowedResponderClientIds?: string[],
): boolean {
  return isAllowedResponderForClient(clientId, allowedResponderClientIds);
}

export type { EligibilityCheck };

/**
 * Check if a client is eligible to respond to an ask with the given
 * authority. Registry-bound wrapper over the controller domain policy.
 */
export function checkAskResponseEligibility(
  clientId: string,
  sessionId: string,
  controllerClientId: string | null,
  authority: AskAuthority,
): EligibilityCheck {
  void sessionId;
  const client = getClientByClientId(clientId);
  return checkAskResponseEligibilityWithInput({
    clientId,
    capabilities: client?.capabilities ?? [],
    controllerClientId,
    authority,
  });
}

export interface AskDeliveryTargets {
  connections: RegisteredConnection[];
  excludeControllerCheck: boolean;
}

function inventoriesFor(sessionId: string, authority: AskAuthority): AskDeliveryInventories<RegisteredConnection> {
  return {
    authority,
    controllerConnections: getControllerConnections(sessionId),
    participantConnections: getParticipantConnections(sessionId),
    clientIdOf: (conn) => conn.clientId,
    identityOf: (conn) => conn.connectionId,
    capabilitiesOf: (clientId) => getClientByClientId(clientId),
    connectionsForClient: (clientId) => getConnectionsForClient(clientId),
    globalClientIds: () => Array.from(getAllClients().keys()),
    participantClientIds: () => getParticipantClientIds(sessionId),
  };
}

/**
 * Resolve which connections should receive an ask based on its authority.
 * Registry-bound wrapper over the controller domain policy.
 */
export function resolveAskDeliveryTargets(
  sessionId: string,
  authority: AskAuthority,
): AskDeliveryTargets {
  const resolved = resolveAskDeliveryTargetsFromInventories(inventoriesFor(sessionId, authority));
  return { connections: resolved.connections, excludeControllerCheck: resolved.excludeControllerCheck };
}

export type { DomainAskDeliveryTargets };

// ── Send helpers ─────────────────────────────────────────────

/**
 * Send a message to the resolved delivery targets for an ask.
 * Falls back to controller-only delivery when no custom targets are needed.
 */
export function sendToAskTargets(
  sessionId: string,
  authority: AskAuthority,
  message: ServerMessage,
  sendFn: (ws: unknown, msg: ServerMessage) => void,
  excludeWs?: unknown,
): void {
  const targets = resolveAskDeliveryTargets(sessionId, authority);

  for (const conn of targets.connections) {
    if (excludeWs && conn.ws === excludeWs) continue;
    sendFn(conn.ws, message);
  }
}

/**
 * Get the list of clientIds eligible to respond to an ask.
 * Used for validation on ask.response.
 */
export function getEligibleResponderClientIds(
  sessionId: string,
  authority: AskAuthority,
): string[] {
  return getEligibleResponderClientIdsFromInventories(authority, {
    capabilitiesOf: (clientId) => getClientByClientId(clientId),
    participantClientIds: () => getParticipantClientIds(sessionId),
    globalClientIds: () => Array.from(getAllClients().keys()),
  });
}
