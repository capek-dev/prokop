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
  getAllControlRecords,
  getControlState,
  handleClaim,
  handleConnectionDisconnect,
  handleRelease,
  handleSessionResume,
  isControlled,
  removeSessionControl,
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

  test('claim from another client takes control immediately', () => {
    const { connectionId: firstId } = registerClient('client-a');
    const { connectionId: secondId } = registerClient('client-b');
    useSession('s');

    handleClaim('s', firstId);
    expect(getControlState('s').controllerClientId).toBe('client-a');

    const takeover = handleClaim('s', secondId);
    expect(takeover.success).toBe(true);
    expect(getControlState('s').controllerClientId).toBe('client-b');
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

  test('resume auto-claims an uncontrolled session for eligible clients', () => {
    const { connectionId } = registerClient('controller');
    useSession('s');

    const result = handleSessionResume('s', connectionId);
    expect(result.transitionReason).toBe('auto_claimed');
    expect(getControlState('s').controllerClientId).toBe('controller');
  });

  test('resume never steals control from another client', () => {
    const { connectionId: firstId } = registerClient('client-a');
    const { connectionId: secondId } = registerClient('client-b');
    useSession('s');

    handleSessionResume('s', firstId);
    const resumed = handleSessionResume('s', secondId);

    expect(resumed.transitionReason).toBeNull();
    expect(getControlState('s').controllerClientId).toBe('client-a');
  });

  test('headless clients are not auto-claimed on resume', () => {
    const { connectionId } = registerClient('headless', 'headless');
    useSession('s');

    const result = handleSessionResume('s', connectionId);
    expect(result.transitionReason).toBeNull();
    expect(getControlState('s').status).toBe('uncontrolled');
  });

  test('disconnect keeps control with the recorded controller', () => {
    const { connectionId } = registerClient('controller');
    useSession('s');

    handleSessionResume('s', connectionId);
    handleConnectionDisconnect(connectionId);

    expect(getControlState('s').status).toBe('controlled');
    expect(getControlState('s').controllerClientId).toBe('controller');
  });

  test('a controller reconnecting after another client claimed becomes an observer', () => {
    const { connectionId: firstId } = registerClient('client-a');
    const { connectionId: secondId } = registerClient('client-b');
    const { connectionId: reconnectId } = registerClient('client-a');
    useSession('s');

    handleSessionResume('s', firstId);
    handleConnectionDisconnect(firstId);
    handleClaim('s', secondId);

    const late = handleSessionResume('s', reconnectId);
    expect(late.transitionReason).toBeNull();
    expect(getControlState('s').controllerClientId).toBe('client-b');
  });

  test('disconnect with a second controller connection keeps control', () => {
    const { connectionId } = registerClient('controller');
    const { connectionId: secondId } = registerClient('controller');
    useSession('s');

    handleSessionResume('s', connectionId);
    handleSessionResume('s', secondId);
    expect(getControlState('s').status).toBe('controlled');

    handleConnectionDisconnect(connectionId);
    expect(getControlState('s').status).toBe('controlled');

    handleConnectionDisconnect(secondId);
    expect(getControlState('s').status).toBe('controlled');
    expect(getControlState('s').controllerClientId).toBe('controller');
  });

  test('getAllControlRecords reflects live records', () => {
    const { connectionId } = registerClient('controller');
    useSession('live');

    handleClaim('live', connectionId);
    expect(getAllControlRecords().get('live')?.controllerClientId).toBe('controller');
  });
});
