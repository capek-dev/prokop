import { describe, expect, test } from 'bun:test';
import type { ServerMessage } from '@prokopai/sdk';
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
    status: 'uncontrolled' as const,
  };
}

function makeControl(overrides: Partial<SessionControlPort<Origin>> = {}): SessionControlPort<Origin> {
  return {
    claim: () => ({ success: false, error: 'no', code: 'already_controlled', controlState: makeControlState('sess-1') }),
    release: () => ({ success: false, error: 'no', code: 'already_controlled', controlState: makeControlState('sess-1') }),
    resumeControl: () => ({ controlState: makeControlState('sess-1'), transitionReason: null }),
    buildControlUpdatedMessage: () => ({ type: 'session.control.updated', control: makeControlState('sess-1'), reason: 'claimed' }),
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

function makeApp(control: SessionControlPort<Origin>): SessionControlApplication<Origin> {
  return createSessionControlApplication({ control });
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

  test('release success broadcasts and failure sends the error', () => {
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
});
