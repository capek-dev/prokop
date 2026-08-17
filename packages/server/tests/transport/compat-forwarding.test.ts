import { describe, expect, test } from 'bun:test';
import type { AskAuthority, ServerMessage } from '@jean2/sdk';
import {
  broadcastEvent,
  broadcastSessionCreated,
  broadcastSessionCreatedExclude,
  broadcastSessionUpdated,
  broadcastToSessionEvent,
  installDeliveryPort,
  registerBroadcastCallback,
  registerBroadcastToSessionCallback,
  registerSendToControllerCallback,
  sendToAskTargetsEvent,
  sendToControllerEvent,
  type DeliveryPort,
} from '@/core/broadcast';
import { createConnectionId } from '@/transport/websocket/connection-id';


describe('core broadcast compatibility and injected delivery', () => {
  test('legacy callback registration still drives every broadcast function', () => {
    const messages: ServerMessage[] = [];
    const excludeCalls: unknown[] = [];
    registerBroadcastCallback((message, excludeWs) => {
      messages.push(message);
      excludeCalls.push(excludeWs);
    });
    const excludeWs = {};

    broadcastEvent({ type: 'error', code: 'x', message: 'y' });
    broadcastSessionCreated({ id: 's1' } as never);
    broadcastSessionCreatedExclude({ id: 's2' } as never, excludeWs);
    broadcastSessionUpdated({ id: 's3' } as never);

    expect(messages.map((m) => m.type)).toEqual([
      'error',
      'session.created',
      'session.created',
      'session.updated',
    ]);
    expect(excludeCalls[0]).toBeUndefined();
    expect(excludeCalls[1]).toBeUndefined();
    expect(excludeCalls[2]).toBe(excludeWs);
    expect(excludeCalls[3]).toBeUndefined();
  });

  test('controller and session events fall back to the global callback when no specific callback exists', () => {
    const messages: ServerMessage[] = [];
    registerBroadcastCallback((message) => {
      messages.push(message);
    });
    registerSendToControllerCallback(null as never);
    registerBroadcastToSessionCallback(null as never);

    sendToControllerEvent('s', { type: 'error', code: 'a', message: 'b' });
    broadcastToSessionEvent('s', { type: 'error', code: 'c', message: 'd' });

    expect(messages).toHaveLength(2);
  });

  test('ask-target events fall back to controller delivery without an installed port', () => {
    const messages: ServerMessage[] = [];
    registerBroadcastCallback((message) => {
      messages.push(message);
    });

    sendToAskTargetsEvent('s', { visibilityScope: 'controller_only', resolutionMode: 'controller_only' } as AskAuthority, {
      type: 'error',
      code: 'x',
      message: 'y',
    });

    expect(messages).toEqual([{ type: 'error', code: 'x', message: 'y' }]);
  });

  test('an installed delivery port takes precedence over legacy callbacks for every audience', () => {
    const calls: string[] = [];
    const port: DeliveryPort = {
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
    };
    installDeliveryPort(port);

    const legacyMessages: ServerMessage[] = [];
    registerBroadcastCallback((message) => {
      legacyMessages.push(message);
    });

    broadcastEvent({ type: 'error', code: 'x', message: 'y' });
    broadcastSessionCreated({ id: 's1' } as never);
    broadcastSessionUpdated({ id: 's2' } as never);
    broadcastToSessionEvent('s', { type: 'error', code: 'x', message: 'y' });
    sendToControllerEvent('s', { type: 'error', code: 'x', message: 'y' });
    sendToAskTargetsEvent('s', { visibilityScope: 'controller_only', resolutionMode: 'controller_only' }, {
      type: 'error',
      code: 'x',
      message: 'y',
    });
    port.sendToConnection(createConnectionId(), { type: 'error', code: 'x', message: 'y' });

    expect(calls).toEqual(['global', 'global', 'global', 'session', 'controller', 'ask_targets', 'origin']);
    expect(legacyMessages).toEqual([]);

    installDeliveryPort(null as never);
  });
});
