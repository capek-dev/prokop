import { describe, expect, test } from 'bun:test';
import {
  applyAutoClaim,
  applyClaim,
  applyRelease,
  applyResume,
  decideControllerGate,
  isAutoClaimEligible,
  makeUncontrolledRecord,
  recordToState,
  type ControllerRecord,
} from '@/domains/controllers';

function record(overrides: Partial<ControllerRecord> = {}): ControllerRecord {
  return {
    ...makeUncontrolledRecord('sess-1'),
    ...overrides,
  };
}

function controlled(clientId = 'controller'): ControllerRecord {
  return record({
    status: 'controlled',
    controllerClientId: clientId,
    controllerConnectionId: 'conn-1',
    acquiredAt: 100,
  });
}

describe('controller domain: gate and eligibility policy', () => {
  test('uncontrolled sessions pass the gate for anyone', () => {
    expect(decideControllerGate(undefined, 'client', 's', 'chat.message')).toBeNull();
    expect(decideControllerGate(record(), 'client', 's', 'chat.message')).toBeNull();
    expect(decideControllerGate(record(), null, 's', 'chat.message')).toBeNull();
  });

  test('a controlled session requires the controller client registration', () => {
    expect(decideControllerGate(controlled(), null, 's', 'chat.message')).toEqual({
      sessionId: 's',
      action: 'chat.message',
      code: 'registration_required',
      message: 'Client must be registered to perform this action',
      control: recordToState(controlled()),
    });
    expect(decideControllerGate(controlled(), 'other', 's', 'chat.message')).toEqual({
      sessionId: 's',
      action: 'chat.message',
      code: 'not_controller',
      message: 'Only the current controller can perform this action',
      control: recordToState(controlled()),
    });
    expect(decideControllerGate(controlled(), 'controller', 's', 'chat.message')).toBeNull();
  });

  test('auto-claim eligibility admits only human and hybrid clients', () => {
    expect(isAutoClaimEligible('human')).toBe(true);
    expect(isAutoClaimEligible('hybrid')).toBe(true);
    expect(isAutoClaimEligible('headless')).toBe(false);
  });

  test('auto-claim applies only to uncontrolled records with eligible clients', () => {
    const rec = record();
    applyAutoClaim(rec, 'human', 'conn-1', 500, true);
    expect(recordToState(rec)).toMatchObject({
      status: 'controlled',
      controllerClientId: 'human',
      controllerConnectionId: 'conn-1',
      acquiredAt: 500,
    });

    const ineligible = record();
    applyAutoClaim(ineligible, 'headless', 'conn-1', 500, false);
    expect(ineligible.status).toBe('uncontrolled');

    const taken = controlled('other');
    applyAutoClaim(taken, 'human', 'conn-2', 500, true);
    expect(taken.controllerClientId).toBe('other');
  });
});

describe('controller domain: claim and release policy', () => {
  test('claim requires registration', () => {
    expect(applyClaim(controlled(), 'sess-1', null, 'conn-1', 500)).toEqual({
      success: false,
      error: 'Client must be registered before claiming control',
      code: 'registration_required',
      controlState: expect.any(Object),
    });
  });

  test('claim on an uncontrolled session succeeds', () => {
    const rec = record();
    const result = applyClaim(rec, 'sess-1', 'controller', 'conn-2', 500);
    expect(result).toMatchObject({ success: true, transitionReason: 'claimed' });
    expect(recordToState(rec)).toMatchObject({
      status: 'controlled',
      controllerClientId: 'controller',
      controllerConnectionId: 'conn-2',
      acquiredAt: 500,
    });
  });

  test('claim from another client takes control immediately (last click wins)', () => {
    const rec = controlled('client-a');
    const result = applyClaim(rec, 'sess-1', 'client-b', 'conn-b', 600);
    expect(result).toMatchObject({ success: true, transitionReason: 'claimed' });
    expect(recordToState(rec)).toMatchObject({
      status: 'controlled',
      controllerClientId: 'client-b',
      controllerConnectionId: 'conn-b',
      acquiredAt: 600,
    });
  });

  test('claim by the current controller is idempotent', () => {
    const rec = controlled('controller');
    const result = applyClaim(rec, 'sess-1', 'controller', 'conn-2', 500);
    expect(result).toMatchObject({ success: true, transitionReason: 'claimed' });
  });

  test('release clears control exactly and rejects non-controllers', () => {
    const rec = controlled('controller');
    expect(applyRelease(rec, 'sess-1', 'controller')).toMatchObject({
      success: true,
      transitionReason: 'released',
    });
    expect(recordToState(rec)).toEqual(expect.objectContaining({
      status: 'uncontrolled',
      controllerClientId: null,
      controllerConnectionId: null,
      acquiredAt: null,
    }));

    expect(applyRelease(controlled('controller'), 'sess-1', 'other')).toMatchObject({
      success: false,
      code: 'not_controller',
      error: 'Only the current controller can release control',
    });
    expect(applyRelease(controlled('controller'), 'sess-1', null)).toMatchObject({
      success: false,
      code: 'registration_required',
    });
  });
});

describe('controller domain: resume policy', () => {
  test('resume auto-claims eligible clients on an uncontrolled session', () => {
    expect(applyResume(record(), 'human', 'conn-1', 500, true)).toMatchObject({
      transitionReason: 'auto_claimed',
    });
    expect(applyResume(record(), 'headless', 'conn-1', 500, false)).toMatchObject({
      transitionReason: null,
    });
  });

  test('resume never takes control from another client', () => {
    const taken = controlled('client-a');
    const resumed = applyResume(taken, 'client-b', 'conn-b', 600, true);
    expect(resumed.transitionReason).toBeNull();
    expect(resumed.controlState.controllerClientId).toBe('client-a');
  });
});
