import { describe, expect, test } from 'bun:test';
import type { ServerMessage } from '@jean2/sdk';
import {
  createSessionControlApplication,
  type SessionControlApplication,
} from '@/application/control';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import type { SessionControlPort } from '@/application/ports/control';

type Origin = string;
const origin: Origin = 'conn-1';

function makeControlState(sessionId: string) {
  return {
    sessionId,
    controllerClientId: null,
    controllerConnectionId: null,
    acquiredAt: null,
    lastHeartbeatAt: null,
    leaseExpiresAt: null,
    status: 'uncontrolled' as const,
    pendingTakeover: null,
  };
}

function makeControl(overrides: Partial<SessionControlPort<Origin>> = {}): SessionControlPort<Origin> {
  return {
    claim: () => ({ success: false, error: 'no', code: 'already_controlled', controlState: makeControlState('sess-1') }),
    release: () => ({ success: false, error: 'no', code: 'already_controlled', controlState: makeControlState('sess-1') }),
    requestTakeover: () => ({ success: false, error: 'no', code: 'already_controlled', controlState: makeControlState('sess-1') }),
    respondTakeover: () => ({ success: false, error: 'no', code: 'already_controlled', controlState: makeControlState('sess-1') }),
    resumeControl: () => ({ controlState: makeControlState('sess-1'), transitionReason: null }),
    buildControlUpdatedMessage: (sessionId) => ({ type: 'session.control.updated', control: makeControlState(sessionId), reason: 'claimed' }),
    ...overrides,
  };
}

interface DeliverySpy {
  sent: ServerMessage[];
  broadcastToSession: Array<{ sessionId: string; message: ServerMessage }>;
}

function makeDelivery(spy: DeliverySpy): ApplicationDeliveryPort<Origin> {
  return {
    send: (o, message) => {
      expect(o).toBe(origin);
      spy.sent.push(message);
    },
    broadcast: () => {},
    broadcastToSession: (sessionId, message) => spy.broadcastToSession.push({ sessionId, message }),
    sendToController: () => {},
    sendToAskTargets: () => {},
  };
}

function makeApp(control: SessionControlPort<Origin>, autoApprove: () => boolean = () => true): SessionControlApplication<Origin> {
  return createSessionControlApplication({ control, autoApproveTakeover: autoApprove });
}

describe('application control use cases', () => {
  test('claim success broadcasts the control updated message through the port', () => {
    const control = makeControl({
      claim: () => ({
        success: true,
        controlState: makeControlState('sess-1'),
        transitionReason: 'claimed',
      }),
    });
    const spy: DeliverySpy = { sent: [], broadcastToSession: [] };
    const delivery = makeDelivery(spy);

    makeApp(control).claim(delivery, origin, 'sess-1');

    expect(spy.broadcastToSession).toEqual([{
      sessionId: 'sess-1',
      message: { type: 'session.control.updated', control: makeControlState('sess-1'), reason: 'claimed' },
    }]);
    expect(spy.sent).toEqual([]);
  });

  test('claim failure sends the exact error to the origin', () => {
    const control = makeControl({
      claim: () => ({
        success: false,
        error: 'Client must be registered before claiming control',
        code: 'registration_required',
        controlState: makeControlState('sess-1'),
      }),
    });
    const spy: DeliverySpy = { sent: [], broadcastToSession: [] };
    const delivery = makeDelivery(spy);

    makeApp(control).claim(delivery, origin, 'sess-1');

    expect(spy.sent).toEqual([{
      type: 'error',
      code: 'registration_required',
      message: 'Client must be registered before claiming control',
    }]);
    expect(spy.broadcastToSession).toEqual([]);
  });

  test('release delegates to the port and broadcasts the transition', () => {
    const calls: string[] = [];
    const control = makeControl({
      release: (sessionId) => {
        calls.push(sessionId);
        return { success: true, controlState: makeControlState(sessionId), transitionReason: 'released' };
      },
      buildControlUpdatedMessage: (sessionId) => ({ type: 'session.control.updated', control: makeControlState(sessionId), reason: 'released' }),
    });
    const spy: DeliverySpy = { sent: [], broadcastToSession: [] };
    const delivery = makeDelivery(spy);

    makeApp(control).release(delivery, origin, 'sess-1');

    expect(calls).toEqual(['sess-1']);
    expect(spy.broadcastToSession[0].message).toMatchObject({ type: 'session.control.updated', reason: 'released' });
  });

  test('requestTakeover passes the injected auto-approve configuration', () => {
    const takeoverCalls: unknown[] = [];
    const control = makeControl({
      requestTakeover: (sessionId, o, autoApprove) => {
        takeoverCalls.push([sessionId, o, autoApprove]);
        return { success: false, error: 'no', code: 'already_controlled', controlState: makeControlState(sessionId) };
      },
    });
    const spy: DeliverySpy = { sent: [], broadcastToSession: [] };
    const delivery = makeDelivery(spy);

    makeApp(control, () => false).requestTakeover(delivery, origin, 'sess-1');
    makeApp(control, () => true).requestTakeover(delivery, origin, 'sess-1');

    expect(takeoverCalls).toEqual([
      ['sess-1', origin, false],
      ['sess-1', origin, true],
    ]);
  });

  test('respondTakeover passes the requester and decision through', () => {
    const respondCalls: unknown[] = [];
    const control = makeControl({
      respondTakeover: (sessionId, o, requesterClientId, decision) => {
        respondCalls.push([sessionId, o, requesterClientId, decision]);
        return { success: true, controlState: makeControlState(sessionId), transitionReason: 'takeover_approved' };
      },
      buildControlUpdatedMessage: (sessionId) => ({ type: 'session.control.updated', control: makeControlState(sessionId), reason: 'takeover_approved' }),
    });
    const spy: DeliverySpy = { sent: [], broadcastToSession: [] };
    const delivery = makeDelivery(spy);

    makeApp(control).respondTakeover(delivery, origin, 'sess-1', 'requester-1', 'approve');

    expect(respondCalls).toEqual([['sess-1', origin, 'requester-1', 'approve']]);
    expect(spy.broadcastToSession).toHaveLength(1);
  });
});
