import { afterEach, describe, expect, test } from 'bun:test';
import type { AskAuthority, ServerMessage } from '@jean2/sdk';
import {
  broadcastEvent,
  broadcastSessionCreated,
  broadcastSessionCreatedExclude,
  broadcastSessionUpdated,
  broadcastToSessionEvent,
  installDeliveryPort,
  sendToAskTargetsEvent,
  sendToControllerEvent,
  type DeliveryPort,
} from '@/transport/websocket/broadcast';
import { type ConnectionId } from '@/transport/websocket/connection-id';
import { registerConnection, unregisterConnection } from '@/transport/websocket/connection-registry';

const authority: AskAuthority = { visibilityScope: 'controller_only', resolutionMode: 'controller_only' };
const sockets: unknown[] = [];

afterEach(() => {
  installDeliveryPort(null as never);
  for (const socket of sockets.splice(0)) {
    unregisterConnection(socket);
  }
});

function createNoopPort(overrides: Partial<DeliveryPort> = {}): DeliveryPort {
  return {
    sendToConnection: () => {},
    broadcast: () => {},
    broadcastToSession: () => {},
    sendToController: () => {},
    sendToAskTargets: () => {},
    ...overrides,
  };
}

describe('core broadcast delivery port', () => {
  test('production broadcast helpers preserve message order and exclusion mapping', () => {
    const calls: Array<{ message: ServerMessage; excludeConnectionId?: ConnectionId }> = [];
    const excludeWs = {};
    const excludeConnectionId = registerConnection(excludeWs);
    sockets.push(excludeWs);
    installDeliveryPort(createNoopPort({
      broadcast: (message, excluded) => {
        calls.push({ message, excludeConnectionId: excluded });
      },
    }));

    broadcastEvent({ type: 'error', code: 'x', message: 'y' });
    broadcastSessionCreated({ id: 's1' } as never);
    broadcastSessionCreatedExclude({ id: 's2' } as never, excludeConnectionId);
    broadcastSessionUpdated({ id: 's3' } as never);

    expect(calls.map(({ message }) => message.type)).toEqual([
      'error',
      'session.created',
      'session.created',
      'session.updated',
    ]);
    expect(calls[0].excludeConnectionId).toBeUndefined();
    expect(calls[1].excludeConnectionId).toBeUndefined();
    expect(calls[2].excludeConnectionId).toBe(excludeConnectionId);
    expect(calls[3].excludeConnectionId).toBeUndefined();
  });

  test('controller and session events use their installed delivery audiences', () => {
    const calls: Array<{ audience: string; sessionId: string }> = [];
    installDeliveryPort(createNoopPort({
      sendToController: (sessionId) => {
        calls.push({ audience: 'controller', sessionId });
      },
      broadcastToSession: (sessionId) => {
        calls.push({ audience: 'session', sessionId });
      },
    }));

    sendToControllerEvent('controller-session', { type: 'error', code: 'a', message: 'b' });
    broadcastToSessionEvent('participant-session', { type: 'error', code: 'c', message: 'd' });

    expect(calls).toEqual([
      { audience: 'controller', sessionId: 'controller-session' },
      { audience: 'session', sessionId: 'participant-session' },
    ]);
  });

  test('ask-target events use the installed ask-target delivery audience', () => {
    const calls: Array<{ sessionId: string; authority: AskAuthority; message: ServerMessage }> = [];
    installDeliveryPort(createNoopPort({
      sendToAskTargets: (sessionId, askAuthority, message) => {
        calls.push({ sessionId, authority: askAuthority, message });
      },
    }));
    const message: ServerMessage = { type: 'error', code: 'x', message: 'y' };

    sendToAskTargetsEvent('s', authority, message);

    expect(calls).toEqual([{ sessionId: 's', authority, message }]);
  });

  test('an installed delivery port routes every production audience without legacy callbacks', () => {
    const calls: string[] = [];
    const port = createNoopPort({
      sendToConnection: () => {
        calls.push('origin');
      },
      broadcast: () => {
        calls.push('global');
      },
      broadcastToSession: () => {
        calls.push('session');
      },
      sendToController: () => {
        calls.push('controller');
      },
      sendToAskTargets: () => {
        calls.push('ask_targets');
      },
    });
    installDeliveryPort(port);

    broadcastEvent({ type: 'error', code: 'x', message: 'y' });
    broadcastSessionCreated({ id: 's1' } as never);
    broadcastSessionUpdated({ id: 's2' } as never);
    broadcastToSessionEvent('s', { type: 'error', code: 'x', message: 'y' });
    sendToControllerEvent('s', { type: 'error', code: 'x', message: 'y' });
    sendToAskTargetsEvent('s', authority, { type: 'error', code: 'x', message: 'y' });
    port.sendToConnection('connection' as ConnectionId, { type: 'error', code: 'x', message: 'y' });

    expect(calls).toEqual(['global', 'global', 'global', 'session', 'controller', 'ask_targets', 'origin']);
  });
});
