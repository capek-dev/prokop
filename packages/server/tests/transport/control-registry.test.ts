import { afterEach, describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import {
  registerConnection,
  unregisterConnection,
  handleClientRegistration,
} from '@/transport/websocket/connection-registry';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import {
  checkControllerGate,
  clearStaleTakeoverRequests,
  getAllControlRecords,
  getControlState,
  handleClaim,
  handleConnectionDisconnect,
  handleRelease,
  handleRequestTakeover,
  handleRespondTakeover,
  handleSessionResume,
  isControlled,
  removeSessionControl,
  sweepExpiredGrace,
} from '@/transport/websocket/control-registry';

const sockets: unknown[] = [];
const sessions: string[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    unregisterConnection(socket);
  }
  for (const sessionId of sessions.splice(0)) {
    removeSessionControl(sessionId);
  }
});

function registerClient(
  clientId: string,
  interactionMode: 'human' | 'headless' | 'hybrid' = 'human',
): { socket: ServerWebSocket; connectionId: ConnectionId } {
  const socket = {} as ServerWebSocket;
  sockets.push(socket);
  const connectionId = registerConnection(socket);
  handleClientRegistration(connectionId, {
    type: 'client.register',
    client: {
      clientId,
      clientType: 'web',
      displayName: clientId,
      interactionMode,
      capabilities: [],
    },
  }, () => {});
  return { socket, connectionId };
}

function useSession(sessionId: string): void {
  sessions.push(sessionId);
}

describe('transport controller registry', () => {
  test('claim on an uncontrolled session succeeds and reports the controller', () => {
    const { connectionId } = registerClient('controller');
    useSession('s');

    const result = handleClaim('s', connectionId);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.transitionReason).toBe('claimed');
      expect(result.controlState.status).toBe('controlled');
      expect(result.controlState.controllerClientId).toBe('controller');
    }
    expect(isControlled('s')).toBe(true);
  });

  test('claim without registration is rejected', () => {
    const socket = {} as ServerWebSocket;
    const connectionId = registerConnection(socket);
    sockets.push(socket);
    useSession('s');

    const result = handleClaim('s', connectionId);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('registration_required');
    }
  });

  test('headless clients are not eligible for auto-claim', () => {
    const { connectionId } = registerClient('headless', 'headless');
    useSession('s');

    const result = handleClaim('s', connectionId);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('not_eligible');
    }
  });

  test('release clears control and a second claim succeeds', () => {
    const { connectionId } = registerClient('controller');
    useSession('s');

    handleClaim('s', connectionId);
    const release = handleRelease('s', connectionId);
    expect(release.success).toBe(true);

    const claimAgain = handleClaim('s', connectionId);
    expect(claimAgain.success).toBe(true);
  });

  test('another client cannot claim a controlled session', () => {
    const { connectionId } = registerClient('controller');
    const { connectionId: otherId } = registerClient('other');
    useSession('s');

    handleClaim('s', connectionId);
    const result = handleClaim('s', otherId);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('already_controlled');
    }
  });

  test('takeover request, deny, and approve flow', () => {
    const { connectionId } = registerClient('controller');
    const { connectionId: otherId } = registerClient('other');
    useSession('s');

    handleClaim('s', connectionId);

    const request = handleRequestTakeover('s', otherId);
    expect(request.success).toBe(true);
    expect(getControlState('s').status).toBe('takeover_requested');

    const deny = handleRespondTakeover('s', connectionId, 'other', 'deny');
    expect(deny.success).toBe(true);
    if (deny.success) expect(deny.transitionReason).toBe('takeover_denied');
    expect(getControlState('s').status).toBe('controlled');

    const requestAgain = handleRequestTakeover('s', otherId);
    expect(requestAgain.success).toBe(true);
    const approve = handleRespondTakeover('s', connectionId, 'other', 'approve');
    expect(approve.success).toBe(true);
    if (approve.success) expect(approve.transitionReason).toBe('takeover_approved');
    expect(getControlState('s').controllerClientId).toBe('other');
  });

  test('takeover auto-approve flag transfers control immediately', () => {
    const { connectionId } = registerClient('controller');
    const { connectionId: otherId } = registerClient('other');
    useSession('s');

    handleClaim('s', connectionId);
    const result = handleRequestTakeover('s', otherId, true);

    expect(result.success).toBe(true);
    if (result.success) expect(result.transitionReason).toBe('takeover_auto_approved');
    expect(getControlState('s').controllerClientId).toBe('other');
  });

  test('controller disconnect enters grace and a sweep expires it', () => {
    const { connectionId } = registerClient('controller');
    useSession('s');

    handleSessionResume('s', connectionId);
    expect(getControlState('s').status).toBe('controlled');

    const transitions = handleConnectionDisconnect(connectionId);
    expect(transitions).toEqual([{ sessionId: 's', reason: 'grace_entered' }]);
    expect(getControlState('s').status).toBe('grace');

    expect(sweepExpiredGrace()).toEqual([]);

    const liveRecord = getAllControlRecords().get('s')!;
    liveRecord.leaseExpiresAt = Date.now() - 1;

    expect(sweepExpiredGrace()).toEqual(['s']);
    expect(getControlState('s').status).toBe('uncontrolled');
  });

  test('disconnect with a second controller connection keeps control and reports no transition', () => {
    const { connectionId } = registerClient('controller');
    const { connectionId: secondId } = registerClient('controller');
    useSession('s');

    handleSessionResume('s', connectionId);
    handleSessionResume('s', secondId);
    expect(getControlState('s').status).toBe('controlled');

    expect(handleConnectionDisconnect(connectionId)).toEqual([]);
    expect(getControlState('s').status).toBe('controlled');

    const transitions = handleConnectionDisconnect(secondId);
    expect(transitions).toEqual([{ sessionId: 's', reason: 'grace_entered' }]);
  });

  test('disconnect transitions are ordered by active session insertion order', () => {
    const { connectionId } = registerClient('controller');
    useSession('first');
    useSession('second');

    handleSessionResume('first', connectionId);
    handleSessionResume('second', connectionId);

    const transitions = handleConnectionDisconnect(connectionId);
    expect(transitions.map((t) => t.sessionId)).toEqual(['first', 'second']);
    expect(transitions.every((t) => t.reason === 'grace_entered')).toBe(true);
  });

  test('pending takeover auto-approves when the controller loses its last connection', () => {
    const { connectionId } = registerClient('controller');
    const { connectionId: otherId } = registerClient('other');
    useSession('s');

    handleClaim('s', connectionId);
    handleRequestTakeover('s', otherId);
    expect(getControlState('s').status).toBe('takeover_requested');

    handleSessionResume('s', connectionId);
    const transitions = handleConnectionDisconnect(connectionId);

    expect(transitions).toEqual([{ sessionId: 's', reason: 'takeover_auto_approved' }]);
    expect(getControlState('s').controllerClientId).toBe('other');
    expect(getControlState('s').status).toBe('controlled');
  });

  test('stale takeover clears to denied while the controller stays connected', () => {
    const { connectionId } = registerClient('controller');
    const { connectionId: otherId } = registerClient('other');
    useSession('s');

    handleClaim('s', connectionId);
    handleRequestTakeover('s', otherId);

    const records = clearStaleTakeoverRequests();
    expect(records).toEqual([]);

    const liveRecord = getAllControlRecords().get('s')!;
    liveRecord.pendingTakeover!.requestedAt = Date.now() - 61_000;

    const stale = clearStaleTakeoverRequests();
    expect(stale).toEqual([{ sessionId: 's', reason: 'takeover_denied' }]);
    expect(getControlState('s').status).toBe('controlled');
    expect(getControlState('s').controllerClientId).toBe('controller');
  });

  test('stale takeover auto-approves when the controller connection is gone', () => {
    const { socket, connectionId } = registerClient('controller');
    const { connectionId: otherId } = registerClient('other');
    useSession('s');

    handleClaim('s', connectionId);
    handleRequestTakeover('s', otherId);
    unregisterConnection(socket);

    const liveRecord = getAllControlRecords().get('s')!;
    liveRecord.pendingTakeover!.requestedAt = Date.now() - 61_000;

    const stale = clearStaleTakeoverRequests();
    expect(stale).toEqual([{ sessionId: 's', reason: 'takeover_auto_approved' }]);
    expect(getControlState('s').controllerClientId).toBe('other');
  });

  test('controller gate preserves uncontrolled, registration, and not_controller outcomes', () => {
    const { connectionId } = registerClient('controller');
    const { connectionId: otherId } = registerClient('other');
    const socket = {} as ServerWebSocket;
    const unknownId = registerConnection(socket);
    sockets.push(socket);
    useSession('s');

    expect(checkControllerGate('s', 'chat.message', connectionId)).toBeNull();

    handleClaim('s', connectionId);

    expect(checkControllerGate('s', 'chat.message', connectionId)).toBeNull();

    const registration = checkControllerGate('s', 'chat.message', unknownId);
    expect(registration?.code).toBe('registration_required');

    const notController = checkControllerGate('s', 'chat.message', otherId);
    expect(notController?.code).toBe('not_controller');
    expect(notController?.action).toBe('chat.message');
  });

  test('grace reattach restores control through a second connection', () => {
    const { connectionId } = registerClient('controller');
    const { connectionId: secondId } = registerClient('controller');
    useSession('s');

    handleSessionResume('s', connectionId);
    handleConnectionDisconnect(connectionId);
    expect(getControlState('s').status).toBe('grace');

    const claim = handleClaim('s', secondId);
    expect(claim.success).toBe(true);
    if (claim.success) expect(claim.transitionReason).toBe('grace_reattached');
    expect(getControlState('s').status).toBe('controlled');
  });
});
