import { describe, expect, test } from 'bun:test';
import type { AskAuthority } from '@prokopai/sdk';
import {
  carrierHasCapabilities,
  checkAskResponseEligibility,
  clientHasCapabilities,
  getEligibleResponderClientIds,
  isAllowedResponder,
  resolveAskDeliveryTargets,
  type AskDeliveryInventories,
} from '@/domains/controllers';

function authority(overrides: Partial<AskAuthority>): AskAuthority {
  return {
    visibilityScope: 'controller_only',
    resolutionMode: 'controller_only',
    ...overrides,
  };
}

interface FakeConn {
  id: string;
  clientId: string | null;
}

const clients: Record<string, { capabilities: string[]; connections: FakeConn[] }> = {
  controller: { capabilities: [], connections: [{ id: 'c1', clientId: 'controller' }] },
  designated: { capabilities: ['browser_tabs'], connections: [{ id: 'd1', clientId: 'designated' }] },
  capable: { capabilities: ['browser_tabs'], connections: [{ id: 'cap1', clientId: 'capable' }] },
  plain: { capabilities: [], connections: [{ id: 'p1', clientId: 'plain' }] },
};

function inventories(overrides: Partial<AskDeliveryInventories<FakeConn>> = {}): AskDeliveryInventories<FakeConn> {
  return {
    authority: authority({}),
    controllerConnections: clients.controller.connections,
    participantConnections: [
      clients.controller.connections[0],
      clients.designated.connections[0],
      clients.capable.connections[0],
      clients.plain.connections[0],
    ],
    clientIdOf: (conn) => conn.clientId,
    identityOf: (conn) => conn.id,
    capabilitiesOf: (clientId) => clients[clientId] as { capabilities: string[] } | undefined,
    connectionsForClient: (clientId) => clients[clientId]?.connections ?? [],
    globalClientIds: () => Object.keys(clients),
    participantClientIds: () => ['controller', 'designated', 'capable', 'plain'],
    ...overrides,
  };
}

describe('controller domain: capability matching', () => {
  test('empty requirements pass, missing capabilities fail, and subsets match', () => {
    expect(clientHasCapabilities([], undefined)).toBe(true);
    expect(clientHasCapabilities([], [])).toBe(true);
    expect(clientHasCapabilities(['browser_tabs'], ['browser_tabs'])).toBe(true);
    expect(clientHasCapabilities(['browser_tabs', 'shell'], ['browser_tabs'])).toBe(true);
    expect(clientHasCapabilities(['shell'], ['browser_tabs'])).toBe(false);
  });

  test('missing carriers pass empty requirements and fail non-empty ones', () => {
    expect(carrierHasCapabilities(undefined, undefined)).toBe(true);
    expect(carrierHasCapabilities(null, [])).toBe(true);
    expect(carrierHasCapabilities(undefined, ['browser_tabs'])).toBe(false);
  });

  test('allowed responders default to open and respect explicit lists', () => {
    expect(isAllowedResponder('x')).toBe(true);
    expect(isAllowedResponder('x', [])).toBe(true);
    expect(isAllowedResponder('x', ['y'])).toBe(false);
    expect(isAllowedResponder('y', ['x', 'y'])).toBe(true);
  });
});

describe('controller domain: ask response eligibility', () => {
  test('controller-only authority admits the controller and rejects others', () => {
    expect(checkAskResponseEligibility({
      clientId: 'controller', capabilities: [], controllerClientId: 'controller', authority: authority({}),
    }).eligible).toBe(true);
    expect(checkAskResponseEligibility({
      clientId: 'other', capabilities: [], controllerClientId: 'controller', authority: authority({}),
    })).toEqual({ eligible: false, reason: 'Only the current controller can respond to this ask' });
    // No controller: anyone may respond (legacy pass-through).
    expect(checkAskResponseEligibility({
      clientId: 'anyone', capabilities: [], controllerClientId: null, authority: authority({}),
    }).eligible).toBe(true);
  });

  test('designated-clients authority enforces the list and capabilities with exact reasons', () => {
    const designatedAuthority = authority({
      resolutionMode: 'designated_clients',
      allowedResponderClientIds: ['designated'],
      requiredCapabilities: ['browser_tabs'],
    });
    expect(checkAskResponseEligibility({
      clientId: 'designated', capabilities: ['browser_tabs'], controllerClientId: 'controller', authority: designatedAuthority,
    }).eligible).toBe(true);
    expect(checkAskResponseEligibility({
      clientId: 'plain', capabilities: [], controllerClientId: 'controller', authority: designatedAuthority,
    })).toEqual({ eligible: false, reason: 'You are not an allowed responder for this ask' });
    expect(checkAskResponseEligibility({
      clientId: 'designated', capabilities: [], controllerClientId: 'controller', authority: designatedAuthority,
    })).toEqual({
      eligible: false,
      reason: 'Your client does not have the required capabilities for this ask',
    });
  });

  test('first-eligible authority checks capabilities only', () => {
    const firstEligible = authority({ resolutionMode: 'first_eligible', requiredCapabilities: ['browser_tabs'] });
    expect(checkAskResponseEligibility({
      clientId: 'capable', capabilities: ['browser_tabs'], controllerClientId: null, authority: firstEligible,
    }).eligible).toBe(true);
    expect(checkAskResponseEligibility({
      clientId: 'plain', capabilities: [], controllerClientId: null, authority: firstEligible,
    })).toEqual({
      eligible: false,
      reason: 'Your client does not have the required capabilities for this ask',
    });
  });

  test('unknown resolution modes deny with the exact malformed-mode reason', () => {
    const unknown = authority({ resolutionMode: 'unsupported' as AskAuthority['resolutionMode'] });
    const decision = checkAskResponseEligibility({
      clientId: 'client', capabilities: [], controllerClientId: null, authority: unknown,
    });
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe('Unknown resolution mode: unsupported');
  });
});

describe('controller domain: ask delivery resolution', () => {
  test('global scope resolves by capabilities, designated list, and default', () => {
    const global = (extra: Partial<AskAuthority>) => resolveAskDeliveryTargets(inventories({
      authority: authority({ visibilityScope: 'global', ...extra }),
    }));

    const first = global({ resolutionMode: 'first_eligible', requiredCapabilities: ['browser_tabs'] });
    expect(first.excludeControllerCheck).toBe(true);
    expect(first.connections.map((c) => c.id).sort()).toEqual(['cap1', 'd1']);

    const designated = global({ resolutionMode: 'designated_clients', allowedResponderClientIds: ['plain'] });
    expect(designated.connections.map((c) => c.id)).toEqual(['p1']);

    const defaulted = global({});
    expect(defaulted.connections.map((c) => c.id).sort()).toEqual(['c1', 'cap1', 'd1', 'p1']);
  });

  test('controller-only scope merges designated and first-eligible participants without duplicates', () => {
    const scoped = (extra: Partial<AskAuthority>) => resolveAskDeliveryTargets(inventories({
      authority: authority({ visibilityScope: 'controller_only', ...extra }),
    }));

    const plain = scoped({});
    expect(plain.connections.map((c) => c.id)).toEqual(['c1']);
    expect(plain.excludeControllerCheck).toBe(false);

    const designated = scoped({ resolutionMode: 'designated_clients', allowedResponderClientIds: ['controller', 'designated'] });
    expect(designated.connections.map((c) => c.id).sort()).toEqual(['c1', 'd1']);
    expect(designated.excludeControllerCheck).toBe(true);

    const first = scoped({ resolutionMode: 'first_eligible', requiredCapabilities: ['browser_tabs'] });
    expect(first.connections.map((c) => c.id).sort()).toEqual(['c1', 'cap1', 'd1']);
    expect(first.excludeControllerCheck).toBe(true);
  });

  test('session_participants scope resolves designated, capable, and default audiences', () => {
    const scoped = (extra: Partial<AskAuthority>) => resolveAskDeliveryTargets(inventories({
      authority: authority({ visibilityScope: 'session_participants', ...extra }),
    }));

    const defaulted = scoped({});
    expect(defaulted.connections.map((c) => c.id)).toEqual(['c1', 'd1', 'cap1', 'p1']);
    expect(defaulted.excludeControllerCheck).toBe(false);

    const designated = scoped({ resolutionMode: 'designated_clients', allowedResponderClientIds: ['designated'] });
    expect(designated.connections.map((c) => c.id)).toEqual(['d1']);
    expect(designated.excludeControllerCheck).toBe(true);

    const first = scoped({ resolutionMode: 'first_eligible', requiredCapabilities: ['browser_tabs'] });
    expect(first.connections.map((c) => c.id).sort()).toEqual(['cap1', 'd1']);
    expect(first.excludeControllerCheck).toBe(true);
  });

  test('eligible responder client ids mirror the resolution modes', () => {
    const base = {
      capabilitiesOf: (id: string) => clients[id] as { capabilities: string[] } | undefined,
      participantClientIds: () => ['controller', 'designated', 'capable', 'plain'],
      globalClientIds: () => Object.keys(clients),
    };

    expect(getEligibleResponderClientIds(authority({}), base)).toEqual([]);

    expect(getEligibleResponderClientIds(
      authority({ resolutionMode: 'designated_clients', allowedResponderClientIds: ['plain', 'designated'], requiredCapabilities: ['browser_tabs'] }),
      base,
    )).toEqual(['designated']);

    expect(getEligibleResponderClientIds(
      authority({ resolutionMode: 'first_eligible', requiredCapabilities: ['browser_tabs'] }),
      base,
    ).sort()).toEqual(['capable', 'designated']);

    expect(getEligibleResponderClientIds(
      authority({ resolutionMode: 'unsupported' as AskAuthority['resolutionMode'] }),
      base,
    )).toEqual([]);
  });
});
