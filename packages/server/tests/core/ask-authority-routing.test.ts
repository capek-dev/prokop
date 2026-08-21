import { describe, expect, test } from 'bun:test';
import type { AskAuthority } from '@prokopai/sdk';
import { checkAskResponseEligibility } from '@/domains/controllers';

function authority(overrides: Partial<AskAuthority>): AskAuthority {
  return {
    visibilityScope: 'controller_only',
    resolutionMode: 'controller_only',
    ...overrides,
  };
}

describe('Jean2 ask response eligibility', () => {
  test('preserves controller-only authority', () => {
    expect(checkAskResponseEligibility({
      clientId: 'controller',
      capabilities: [],
      controllerClientId: 'controller',
      authority: authority({}),
    }).eligible).toBe(true);
    expect(checkAskResponseEligibility({
      clientId: 'other',
      capabilities: [],
      controllerClientId: 'controller',
      authority: authority({}),
    }).eligible).toBe(false);
  });

  test('preserves designated-client authority', () => {
    const decision = checkAskResponseEligibility({
      clientId: 'designated',
      capabilities: ['browser_tabs'],
      controllerClientId: 'controller',
      authority: authority({
        resolutionMode: 'designated_clients',
        allowedResponderClientIds: ['designated'],
        requiredCapabilities: ['browser_tabs'],
      }),
    });
    expect(decision.eligible).toBe(true);
  });

  test('preserves first-eligible capability authority', () => {
    expect(checkAskResponseEligibility({
      clientId: 'capable',
      capabilities: ['browser_tabs'],
      controllerClientId: null,
      authority: authority({ resolutionMode: 'first_eligible', requiredCapabilities: ['browser_tabs'] }),
    }).eligible).toBe(true);
    expect(checkAskResponseEligibility({
      clientId: 'missing',
      capabilities: [],
      controllerClientId: null,
      authority: authority({ resolutionMode: 'first_eligible', requiredCapabilities: ['browser_tabs'] }),
    }).eligible).toBe(false);
  });

  test('denies unknown authority modes', () => {
    const unknown = authority({ resolutionMode: 'unsupported' as AskAuthority['resolutionMode'] });
    const decision = checkAskResponseEligibility({
      clientId: 'client',
      capabilities: [],
      controllerClientId: null,
      authority: unknown,
    });
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toContain('Unknown resolution mode');
  });
});
