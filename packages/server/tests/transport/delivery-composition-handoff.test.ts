import { afterEach, describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { type RuntimeDelivery, type RuntimeEvent } from '@capekai/core';
import { jean2DeliveryBindings } from '@/adapters/capek/delivery';
import { deliverCapekEvent } from '@/adapters/capek/events';
import { createBunWebSocketAdapter } from '@/transport/websocket/bun-adapter';
import { installDeliveryPort } from '@/transport/websocket/broadcast';
import { unregisterConnection } from '@/transport/websocket/connection-registry';

const sockets: unknown[] = [];

afterEach(() => {
  installDeliveryPort(null as never);
  for (const socket of sockets.splice(0)) {
    unregisterConnection(socket);
  }
});

function failureEvent(): RuntimeEvent {
  return { kind: 'failure', category: 'generic', code: 'test', message: 'test' };
}

function sessionCreatedEvent(): RuntimeEvent {
  return { kind: 'session', action: 'created', session: { id: 'sess-1' } as never };
}

describe('S2 C2 composition delivery handoff', () => {
  test('the C2 delivery binding emits through deliverCapekEvent by identity', () => {
    expect(jean2DeliveryBindings.emit).toBe(deliverCapekEvent);
  });

  test('deliverCapekEvent routes every host audience through the installed port', () => {
    const calls: Array<{ audience: string; sessionId?: string }> = [];
    let notificationCalls = 0;
    const port = {
      sendToConnection: () => {},
      broadcast: () => {
        calls.push({ audience: 'global' });
      },
      broadcastToSession: (sessionId: string) => {
        calls.push({ audience: 'session', sessionId });
      },
      sendToController: (sessionId: string) => {
        calls.push({ audience: 'controller', sessionId });
      },
      sendToAskTargets: (sessionId: string) => {
        calls.push({ audience: 'ask_targets', sessionId });
      },
    };
    installDeliveryPort(port);

    const authority = { visibilityScope: 'controller_only' as const, resolutionMode: 'controller_only' as const };
    deliverCapekEvent({ audience: { scope: 'global' }, event: failureEvent() });
    deliverCapekEvent({ audience: { scope: 'session', sessionId: 's' }, event: failureEvent() });
    deliverCapekEvent({ audience: { scope: 'controller', sessionId: 's' }, event: failureEvent() });
    deliverCapekEvent({
      audience: { scope: 'ask_targets', sessionId: 's', authority },
      event: failureEvent(),
    });
    // Origin and host audiences stay out of the socket protocol.
    deliverCapekEvent({ audience: { scope: 'origin', origin: {} }, event: failureEvent() });
    deliverCapekEvent(
      {
        audience: { scope: 'host' },
        event: { kind: 'terminal', sessionId: 's', message: { id: 'm' } as never },
      } as RuntimeDelivery,
      { notifyTerminalMessage: () => { notificationCalls += 1; } },
    );

    expect(calls).toEqual([
      { audience: 'global' },
      { audience: 'session', sessionId: 's' },
      { audience: 'controller', sessionId: 's' },
      { audience: 'ask_targets', sessionId: 's' },
    ]);
    expect(notificationCalls).toBe(1);
  });

  test('the production transport port installed into the composition path reaches sockets', () => {
    const adapter = createBunWebSocketAdapter({
      auth: { isAuthEnabled: () => false, validateToken: () => true },
      terminal: {
        getManager: () => ({}) as never,
        getEventManager: () => ({}) as never,
      },
      resolveAskTargets: () => [],
    });
    installDeliveryPort(adapter.delivery);

    const sent: string[] = [];
    const socket = {
      data: { path: '/ws' },
      readyState: WebSocket.OPEN,
      send(data: string) {
        sent.push(data);
      },
      close() {},
    } as unknown as ServerWebSocket;
    sockets.push(socket);

    adapter.websocket.open!(socket as never);

    // The composition delivery binding is what a composed run emits through.
    // S2 wires it to the production transport port at bootstrap.
    jean2DeliveryBindings.emit({ audience: { scope: 'global' }, event: sessionCreatedEvent() });

    expect(sent).toEqual([JSON.stringify({ type: 'session.created', session: { id: 'sess-1' } })]);
  });

  test('S2 does not claim a live composed execution scope: the composition is a handoff representation only', () => {
    // createJean2RuntimeComposition stays a representation that requires the
    // full adapter installation from createRuntime(). S2 adopts only the
    // delivery handoff; production execution still runs on the current path.
    // This test pins that the handoff does not depend on composing a scope.
    const adapter = createBunWebSocketAdapter({
      auth: { isAuthEnabled: () => false, validateToken: () => true },
      terminal: {
        getManager: () => ({}) as never,
        getEventManager: () => ({}) as never,
      },
      resolveAskTargets: () => [],
    });

    expect(adapter.delivery).toBeDefined();
  });
});
