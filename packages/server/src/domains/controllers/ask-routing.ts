import type { AskAuthority, ClientCapability } from '@jean2/sdk';

/**
 * Controller domain: ask response eligibility and ask delivery audience
 * policy.
 *
 * Pure decision functions over injected inventories. Who may SEE an ask
 * (visibility scope), who may RESPOND (resolution mode plus capabilities
 * and designated responders), and the malformed/unknown-mode denial rule
 * all live here. Transport and the compatibility wrappers supply the
 * connection and client inventories; this module never reads registries.
 */

// ── Capability matching ──────────────────────────────────────

/** A capability-carrying client view; the domain never imports the
 * connection registry. */
export interface CapabilityCarrier {
  capabilities: string[];
}

export function clientHasCapabilities(
  capabilities: string[],
  requiredCapabilities?: ClientCapability[],
): boolean {
  if (!requiredCapabilities || requiredCapabilities.length === 0) {
    return true;
  }
  return requiredCapabilities.every(cap => capabilities.includes(cap));
}

/** Capability match for an optional carrier: missing carriers fail any
 * non-empty requirement exactly like the pre-domain registry lookup. */
export function carrierHasCapabilities(
  carrier: CapabilityCarrier | null | undefined,
  requiredCapabilities?: ClientCapability[],
): boolean {
  if (!requiredCapabilities || requiredCapabilities.length === 0) {
    return true;
  }
  if (!carrier) return false;
  return clientHasCapabilities(carrier.capabilities, requiredCapabilities);
}

export function isAllowedResponder(
  clientId: string,
  allowedResponderClientIds?: string[],
): boolean {
  if (!allowedResponderClientIds || allowedResponderClientIds.length === 0) {
    return true;
  }
  return allowedResponderClientIds.includes(clientId);
}

// ── Eligibility check ────────────────────────────────────────

export interface EligibilityCheck {
  eligible: boolean;
  reason?: string;
}

export interface AskResponseEligibilityInput {
  clientId: string;
  /** The responder's capabilities (empty when unregistered). */
  capabilities: string[];
  controllerClientId: string | null;
  authority: AskAuthority;
}

/**
 * Check whether a client is eligible to respond to an ask with the given
 * authority. Unknown resolution modes deny with the exact malformed-mode
 * message.
 */
export function checkAskResponseEligibility(
  input: AskResponseEligibilityInput,
): EligibilityCheck {
  const { clientId, capabilities, controllerClientId, authority } = input;
  const { resolutionMode, allowedResponderClientIds, requiredCapabilities } = authority;

  switch (resolutionMode) {
    case 'controller_only': {
      if (controllerClientId === null) {
        return { eligible: true };
      }
      if (clientId !== controllerClientId) {
        return {
          eligible: false,
          reason: 'Only the current controller can respond to this ask',
        };
      }
      return { eligible: true };
    }

    case 'designated_clients': {
      if (allowedResponderClientIds && allowedResponderClientIds.length > 0) {
        if (!allowedResponderClientIds.includes(clientId)) {
          return {
            eligible: false,
            reason: 'You are not an allowed responder for this ask',
          };
        }
      }

      if (!clientHasCapabilities(capabilities, requiredCapabilities)) {
        return {
          eligible: false,
          reason: 'Your client does not have the required capabilities for this ask',
        };
      }

      return { eligible: true };
    }

    case 'first_eligible': {
      if (!clientHasCapabilities(capabilities, requiredCapabilities)) {
        return {
          eligible: false,
          reason: 'Your client does not have the required capabilities for this ask',
        };
      }

      return { eligible: true };
    }

    default:
      return { eligible: false, reason: `Unknown resolution mode: ${resolutionMode}` };
  }
}

// ── Delivery target resolution ───────────────────────────────

export interface AskDeliveryTargets<C> {
  connections: C[];
  excludeControllerCheck: boolean;
}

export interface AskDeliveryInventories<C> {
  authority: AskAuthority;
  /** Controller connections for the session (current controller's client). */
  controllerConnections: C[];
  /** All participant connections for the session. */
  participantConnections: C[];
  /** Client id of a connection, null when unregistered. */
  clientIdOf(connection: C): string | null;
  /** Identity key used for dedup (connection id). */
  identityOf(connection: C): unknown;
  /** Capability carrier for a client, undefined when unregistered. */
  capabilitiesOf(clientId: string): CapabilityCarrier | undefined;
  /** All connections of a client. */
  connectionsForClient(clientId: string): C[];
  /** Every globally registered client id. */
  globalClientIds(): string[];
  /** Participant client ids of the session. */
  participantClientIds(): string[];
}

/**
 * Resolve which connections receive an ask based on its authority.
 * Mirrors the pre-domain resolution exactly: visibility scope picks the
 * base audience, resolution mode plus capabilities expand or restrict it.
 */
export function resolveAskDeliveryTargets<C>(
  inventories: AskDeliveryInventories<C>,
): AskDeliveryTargets<C> {
  const { authority } = inventories;
  const { visibilityScope, resolutionMode, allowedResponderClientIds, requiredCapabilities } = authority;

  const globalCapabilityConnections = (): C[] => {
    const result: C[] = [];
    for (const clientId of inventories.globalClientIds()) {
      if (!carrierHasCapabilities(inventories.capabilitiesOf(clientId), requiredCapabilities)) continue;
      result.push(...inventories.connectionsForClient(clientId));
    }
    return result;
  };

  // Global scope: deliver to all connected clients with matching
  // capabilities, regardless of session participation.
  if (visibilityScope === 'global') {
    if (resolutionMode === 'first_eligible' && requiredCapabilities && requiredCapabilities.length > 0) {
      const eligibleConns = globalCapabilityConnections();
      return { connections: eligibleConns, excludeControllerCheck: true };
    }
    if (resolutionMode === 'designated_clients' && allowedResponderClientIds && allowedResponderClientIds.length > 0) {
      const conns: C[] = [];
      for (const clientId of allowedResponderClientIds) {
        conns.push(...inventories.connectionsForClient(clientId));
      }
      return { connections: conns, excludeControllerCheck: true };
    }
    const allConns = globalCapabilityConnections();
    return { connections: allConns, excludeControllerCheck: true };
  }

  // Base delivery: visibility scope determines initial audience
  if (visibilityScope === 'controller_only') {
    const controllerConns = [...inventories.controllerConnections];

    if (resolutionMode === 'designated_clients' && allowedResponderClientIds && allowedResponderClientIds.length > 0) {
      const allConns = inventories.participantConnections;
      const designatedConns = allConns.filter(conn => {
        const clientId = inventories.clientIdOf(conn);
        return clientId !== null && allowedResponderClientIds.includes(clientId);
      });
      const seen = new Set(controllerConns.map(c => inventories.identityOf(c)));
      for (const conn of designatedConns) {
        if (!seen.has(inventories.identityOf(conn))) {
          controllerConns.push(conn);
          seen.add(inventories.identityOf(conn));
        }
      }
      return { connections: controllerConns, excludeControllerCheck: true };
    }

    if (resolutionMode === 'first_eligible' && requiredCapabilities && requiredCapabilities.length > 0) {
      const allConns = inventories.participantConnections;
      const eligibleConns = allConns.filter(conn => {
        const clientId = inventories.clientIdOf(conn);
        return clientId !== null && carrierHasCapabilities(inventories.capabilitiesOf(clientId), requiredCapabilities);
      });
      const seen = new Set(controllerConns.map(c => inventories.identityOf(c)));
      for (const conn of eligibleConns) {
        if (!seen.has(inventories.identityOf(conn))) {
          controllerConns.push(conn);
          seen.add(inventories.identityOf(conn));
        }
      }
      return { connections: controllerConns, excludeControllerCheck: true };
    }

    return { connections: controllerConns, excludeControllerCheck: false };
  }

  // visibilityScope === 'session_participants'
  const allConns = inventories.participantConnections;

  if (resolutionMode === 'designated_clients' && allowedResponderClientIds && allowedResponderClientIds.length > 0) {
    const designatedConns = allConns.filter(conn => {
      const clientId = inventories.clientIdOf(conn);
      return clientId !== null && allowedResponderClientIds.includes(clientId);
    });
    return { connections: designatedConns, excludeControllerCheck: true };
  }

  if (resolutionMode === 'first_eligible' && requiredCapabilities && requiredCapabilities.length > 0) {
    const eligibleConns = allConns.filter(conn => {
      const clientId = inventories.clientIdOf(conn);
      return clientId !== null && carrierHasCapabilities(inventories.capabilitiesOf(clientId), requiredCapabilities);
    });
    return { connections: eligibleConns, excludeControllerCheck: true };
  }

  // Default: all participants see it, controller_only resolution
  return { connections: allConns, excludeControllerCheck: false };
}

/**
 * Get the list of clientIds eligible to respond to an ask. Used for
 * validation on ask.response.
 */
export function getEligibleResponderClientIds(
  authority: AskAuthority,
  inventories: Pick<
    AskDeliveryInventories<never>,
    'capabilitiesOf' | 'participantClientIds' | 'globalClientIds'
  >,
): string[] {
  const { resolutionMode, allowedResponderClientIds, requiredCapabilities } = authority;

  switch (resolutionMode) {
    case 'controller_only':
      return [];

    case 'designated_clients': {
      if (allowedResponderClientIds && allowedResponderClientIds.length > 0) {
        return allowedResponderClientIds.filter(id =>
          carrierHasCapabilities(inventories.capabilitiesOf(id), requiredCapabilities),
        );
      }
      return inventories.participantClientIds().filter(id =>
        carrierHasCapabilities(inventories.capabilitiesOf(id), requiredCapabilities),
      );
    }

    case 'first_eligible':
      return inventories.globalClientIds().filter(id =>
        carrierHasCapabilities(inventories.capabilitiesOf(id), requiredCapabilities),
      );

    default:
      return [];
  }
}
