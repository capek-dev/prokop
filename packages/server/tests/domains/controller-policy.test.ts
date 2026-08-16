import { describe, expect, test } from 'bun:test';
import {
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
  GRACE_DURATION_MS,
  isAutoClaimEligible,
  isGraceExpired,
  makeUncontrolledRecord,
  recordToState,
  TAKEOVER_REQUEST_TIMEOUT_MS,
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
    lastHeartbeatAt: 100,
  });
}

function takeoverRequested(controller = 'controller', requester = 'requester'): ControllerRecord {
  return record({
    status: 'takeover_requested',
    controllerClientId: controller,
    controllerConnectionId: 'conn-1',
    acquiredAt: 100,
    lastHeartbeatAt: 100,
    pendingTakeover: { requestedByClientId: requester, requestedAt: 200 },
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
});

describe('controller domain: claim and release policy', () => {
  test('claim on an uncontrolled record auto-claims eligible clients with the exact transition', () => {
    const rec = record();
    const result = applyClaim(rec, 'sess-1', 'client', 'conn-9', 500, true);
    expect(result).toEqual({
      success: true,
      controlState: expect.objectContaining({ status: 'controlled', controllerClientId: 'client' }),
      transitionReason: 'claimed',
    });
    expect(recordToState(rec)).toMatchObject({
      status: 'controlled',
      controllerClientId: 'client',
      controllerConnectionId: 'conn-9',
      acquiredAt: 500,
      lastHeartbeatAt: 500,
      leaseExpiresAt: null,
      pendingTakeover: null,
    });
  });

  test('claim without registration is rejected without creating records', () => {
    const result = applyClaim(undefined, 'sess-1', null, 'conn-9', 500, false);
    expect(result).toEqual({
      success: false,
      error: 'Client must be registered before claiming control',
      code: 'registration_required',
      controlState: expect.objectContaining({ sessionId: 'sess-1', status: 'uncontrolled' }),
    });
  });

  test('claim by an ineligible client fails with the exact not_eligible error', () => {
    const rec = record();
    const result = applyClaim(rec, 'sess-1', 'headless', 'conn-9', 500, false);
    expect(result).toEqual({
      success: false,
      error: 'Claim failed \u2014 client may not be eligible',
      code: 'not_eligible',
      controlState: recordToState(rec),
    });
    expect(rec.status).toBe('uncontrolled');
  });

  test('claim by the current controller succeeds without transition', () => {
    const rec = controlled('controller');
    const result = applyClaim(rec, 'sess-1', 'controller', 'conn-2', 500, true);
    expect(result).toMatchObject({ success: true, transitionReason: 'claimed' });
  });

  test('claim during grace reattaches the controller and rejects others with exact messages', () => {
    const rec = record({
      status: 'grace',
      controllerClientId: 'controller',
      leaseExpiresAt: 500 + GRACE_DURATION_MS,
    });
    const reattach = applyClaim(rec, 'sess-1', 'controller', 'conn-3', 500, true);
    expect(reattach).toMatchObject({ success: true, transitionReason: 'grace_reattached' });
    expect(recordToState(rec).status).toBe('controlled');

    const other = applyClaim(record({ status: 'grace', controllerClientId: 'controller', leaseExpiresAt: 99999 }), 'sess-1', 'other', 'conn-4', 500, true);
    expect(other).toEqual({
      success: false,
      error: 'Session is in grace period for another client',
      code: 'already_controlled',
      controlState: expect.any(Object),
    });
  });

  test('claim against controlled, grace, and takeover_requested records keeps the exact already_controlled messages', () => {
    expect(applyClaim(controlled('a'), 'sess-1', 'b', 'conn-5', 500, true)).toMatchObject({
      success: false,
      code: 'already_controlled',
      error: 'Session is already controlled by another client',
    });
    expect(applyClaim(takeoverRequested(), 'sess-1', 'third', 'conn-5', 500, true)).toMatchObject({
      success: false,
      code: 'already_controlled',
      error: 'A takeover request is already pending for this session',
    });
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
      lastHeartbeatAt: null,
      leaseExpiresAt: null,
      pendingTakeover: null,
    }));

    expect(applyRelease(controlled(), 'sess-1', 'other')).toMatchObject({
      success: false,
      code: 'not_controller',
      error: 'Only the current controller can release control',
    });
    expect(applyRelease(controlled(), 'sess-1', null)).toMatchObject({
      success: false,
      code: 'registration_required',
    });
    expect(applyRelease(undefined, 'sess-1', 'x')).toMatchObject({
      success: false,
      code: 'not_controller',
      error: 'No control record for this session',
    });
    expect(applyRelease(record({ status: 'grace', controllerClientId: 'x' }), 'sess-1', 'x')).toMatchObject({
      success: false,
      code: 'invalid_state',
      error: "Cannot release control from status 'grace'",
    });
  });
});

describe('controller domain: takeover policy', () => {
  test('request takeover requires a controlled session and a different client', () => {
    expect(applyRequestTakeover(undefined, 'sess-1', 'x', 500, false)).toMatchObject({
      success: false,
      code: 'session_uncontrolled',
      error: 'No control record for this session',
    });
    expect(applyRequestTakeover(record(), 'sess-1', 'x', 500, false)).toMatchObject({
      success: false,
      code: 'session_uncontrolled',
      error: 'Session is uncontrolled \u2014 use claim instead',
    });
    expect(applyRequestTakeover(controlled('a'), 'sess-1', 'a', 500, false)).toMatchObject({
      success: false,
      code: 'already_controller',
      error: 'You already control this session',
    });
    expect(applyRequestTakeover(takeoverRequested(), 'sess-1', 'other', 500, false)).toMatchObject({
      success: false,
      code: 'takeover_pending',
    });
  });

  test('auto-approve takeover swaps the controller', () => {
    const rec = controlled('old');
    const result = applyRequestTakeover(rec, 'sess-1', 'new', 500, true);
    expect(result).toMatchObject({ success: true, transitionReason: 'takeover_auto_approved' });
    expect(recordToState(rec)).toMatchObject({
      status: 'controlled',
      controllerClientId: 'new',
      controllerConnectionId: null,
      acquiredAt: 500,
      pendingTakeover: null,
    });
  });

  test('a takeover request records the requester and time', () => {
    const rec = controlled('old');
    const result = applyRequestTakeover(rec, 'sess-1', 'new', 500, false);
    expect(result).toMatchObject({ success: true, transitionReason: 'takeover_requested' });
    expect(recordToState(rec)).toMatchObject({
      status: 'takeover_requested',
      controllerClientId: 'old',
      pendingTakeover: { requestedByClientId: 'new', requestedAt: 500 },
    });
  });

  test('respond takeover approves, denies, and rejects mismatches with exact codes', () => {
    const rec = takeoverRequested('controller', 'requester');
    expect(applyRespondTakeover(rec, 'sess-1', 'controller', 'requester', 'approve', 600)).toMatchObject({
      success: true,
      transitionReason: 'takeover_approved',
    });
    expect(recordToState(rec)).toMatchObject({
      status: 'controlled',
      controllerClientId: 'requester',
      controllerConnectionId: null,
      pendingTakeover: null,
    });

    const denied = takeoverRequested('controller', 'requester');
    expect(applyRespondTakeover(denied, 'sess-1', 'controller', 'requester', 'deny', 600)).toMatchObject({
      success: true,
      transitionReason: 'takeover_denied',
    });
    expect(recordToState(denied)).toMatchObject({ status: 'controlled', controllerClientId: 'controller', pendingTakeover: null });

    expect(applyRespondTakeover(takeoverRequested('controller', 'requester'), 'sess-1', 'controller', 'someone-else', 'approve', 600)).toMatchObject({
      success: false,
      code: 'takeover_mismatch',
      error: 'Takeover request does not match the specified requester',
    });
    expect(applyRespondTakeover(takeoverRequested('controller', 'requester'), 'sess-1', 'other', 'requester', 'approve', 600)).toMatchObject({
      success: false,
      code: 'not_controller',
    });
    expect(applyRespondTakeover(controlled('controller'), 'sess-1', 'controller', 'requester', 'approve', 600)).toMatchObject({
      success: false,
      code: 'no_takeover_pending',
    });
  });

  test('stale takeover decisions split on controller liveness after the timeout', () => {
    const stale = takeoverRequested('controller', 'requester');
    stale.pendingTakeover = { requestedByClientId: 'requester', requestedAt: 0 };
    expect(decideStaleTakeover(stale, TAKEOVER_REQUEST_TIMEOUT_MS + 1, true)).toBe('clear_denied');
    expect(decideStaleTakeover(stale, TAKEOVER_REQUEST_TIMEOUT_MS + 1, false)).toBe('auto_approve');
    expect(decideStaleTakeover(stale, TAKEOVER_REQUEST_TIMEOUT_MS - 1, false)).toBeNull();
    expect(decideStaleTakeover(controlled(), 999999, false)).toBeNull();
  });

  test('takeover auto-approve applies the pending requester', () => {
    const rec = takeoverRequested('controller', 'requester');
    expect(applyTakeoverAutoApprove(rec, 700)).toBe(true);
    expect(recordToState(rec)).toMatchObject({
      status: 'controlled',
      controllerClientId: 'requester',
      controllerConnectionId: null,
      pendingTakeover: null,
    });
    expect(applyTakeoverAutoApprove(controlled(), 700)).toBe(false);
  });
});

describe('controller domain: grace, resume, and disconnect policy', () => {
  test('grace entry only applies to controlled records', () => {
    expect(applyGraceEntry(controlled(), 500)).toBe(true);
    expect(applyGraceEntry(record(), 500)).toBe(false);
    expect(applyGraceEntry(undefined, 500)).toBe(false);

    const rec = controlled();
    applyGraceEntry(rec, 500);
    expect(recordToState(rec)).toMatchObject({
      status: 'grace',
      controllerConnectionId: null,
      leaseExpiresAt: 500 + GRACE_DURATION_MS,
    });
  });

  test('grace reattach keeps the controller inside the lease and expires after', () => {
    const rec = controlled();
    applyGraceEntry(rec, 500);

    expect(applyGraceReattach(rec, 'other', 'conn-x', 600)).toBe(false);
    expect(applyGraceReattach(rec, 'controller', 'conn-y', 600)).toBe(true);
    expect(recordToState(rec)).toMatchObject({ status: 'controlled', controllerConnectionId: 'conn-y', leaseExpiresAt: null });

    applyGraceEntry(rec, 600);
    expect(applyGraceReattach(rec, 'controller', 'conn-z', 600 + GRACE_DURATION_MS + 1)).toBe(false);
    expect(recordToState(rec).status).toBe('uncontrolled');
    expect(isGraceExpired(rec, 600 + GRACE_DURATION_MS + 1)).toBe(false);
  });

  test('grace expiry resets the record', () => {
    const rec = controlled();
    applyGraceEntry(rec, 500);
    expect(isGraceExpired(rec, 500 + GRACE_DURATION_MS + 1)).toBe(true);
    applyGraceExpiry(rec);
    expect(recordToState(rec)).toEqual(expect.objectContaining({
      status: 'uncontrolled',
      controllerClientId: null,
      controllerConnectionId: null,
      acquiredAt: null,
      lastHeartbeatAt: null,
      leaseExpiresAt: null,
      pendingTakeover: null,
    }));
  });

  test('resume auto-claims eligible clients and reattaches during grace', () => {
    expect(applyResume(record(), 'human', 'conn-1', 500, true)).toMatchObject({
      transitionReason: 'auto_claimed',
    });
    expect(applyResume(record(), 'headless', 'conn-1', 500, false)).toMatchObject({
      transitionReason: null,
    });

    const graced = controlled();
    applyGraceEntry(graced, 500);
    const resumed = applyResume(graced, 'controller', 'conn-2', 600, true);
    expect(resumed.transitionReason).toBe('grace_reattached');
  });

  test('disconnect decisions distinguish controller, takeover request, and participants', () => {
    expect(decideDisconnectTransition(controlled('a'), 'a')).toBe('grace');
    expect(decideDisconnectTransition(takeoverRequested('a', 'b'), 'a')).toBe('takeover_auto_approved');
    expect(decideDisconnectTransition(takeoverRequested('a', 'b'), 'b')).toBeNull();
    expect(decideDisconnectTransition(controlled('a'), 'b')).toBeNull();
    expect(decideDisconnectTransition(record({ status: 'grace', controllerClientId: 'a' }), 'a')).toBeNull();
  });
});
