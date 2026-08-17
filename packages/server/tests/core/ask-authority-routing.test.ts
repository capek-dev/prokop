import { afterEach, describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import type { AskAuthority } from '@jean2/sdk';
import { checkAskResponseEligibility } from '@/core/capability-router';
import {
  handleClientRegistration,
  registerConnection,
  unregisterConnection,
} from '@/transport/websocket/connection-registry';

const sockets: ServerWebSocket[] = [];

function authority(overrides: Partial<AskAuthority>): AskAuthority {
  return {
    visibilityScope: 'controller_only',
    resolutionMode: 'controller_only',
    ...overrides,
  };
}

function registerClient(clientId: string, capabilities: string[]): void {
  const socket = {} as ServerWebSocket;
  sockets.push(socket);
  const connectionId = registerConnection(socket);
  handleClientRegistration(connectionId, {
    type: 'client.register',
    client: {
      clientId,
      clientType: 'web',
      displayName: clientId,
      interactionMode: 'human',
      capabilities,
    },
  }, () => {});
}

afterEach(() => {
  for (const socket of sockets.splice(0)) unregisterConnection(socket);
});

describe('Jean2 ask response eligibility', () => {
  test('preserves controller-only authority', () => {
    expect(checkAskResponseEligibility('controller', 'session', 'controller', authority({})).eligible)
      .toBe(true);
    expect(checkAskResponseEligibility('other', 'session', 'controller', authority({})).eligible)
      .toBe(false);
  });

  test('preserves designated-client authority', () => {
    registerClient('designated', ['browser_tabs']);
    const decision = checkAskResponseEligibility(
      'designated',
      'session',
      'controller',
      authority({
        resolutionMode: 'designated_clients',
        allowedResponderClientIds: ['designated'],
        requiredCapabilities: ['browser_tabs'],
      }),
    );
    expect(decision.eligible).toBe(true);
  });

  test('preserves first-eligible capability authority', () => {
    registerClient('capable', ['browser_tabs']);
    expect(checkAskResponseEligibility(
      'capable',
      'session',
      null,
      authority({ resolutionMode: 'first_eligible', requiredCapabilities: ['browser_tabs'] }),
    ).eligible).toBe(true);
    expect(checkAskResponseEligibility(
      'missing',
      'session',
      null,
      authority({ resolutionMode: 'first_eligible', requiredCapabilities: ['browser_tabs'] }),
    ).eligible).toBe(false);
  });

  test('denies unknown authority modes', () => {
    const unknown = authority({ resolutionMode: 'unsupported' as AskAuthority['resolutionMode'] });
    const decision = checkAskResponseEligibility('client', 'session', null, unknown);
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toContain('Unknown resolution mode');
  });
});
