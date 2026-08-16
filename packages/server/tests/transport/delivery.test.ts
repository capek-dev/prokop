import { describe, expect, test } from 'bun:test';
import type { ServerMessage } from '@jean2/sdk';
import { createDeliveryPort } from '@/transport/websocket/delivery';
import { createConnectionId, type ConnectionId } from '@/transport/websocket/connection-id';

const authority = { visibilityScope: 'controller_only' as const, resolutionMode: 'controller_only' as const };

function makePort(overrides: Partial<Parameters<typeof createDeliveryPort>[0]> = {}) {
  const unchecked: Array<{ id: ConnectionId; message: ServerMessage }> = [];
  const checked: Array<{ id: ConnectionId; message: ServerMessage }> = [];

  const port = createDeliveryPort({
    sendToConnection: (id, message) => {
      unchecked.push({ id, message });
    },
    sendToOpenConnection: (id, message) => {
      checked.push({ id, message });
    },
    connectionIds: () => [],
    participantConnectionIds: () => [],
    controllerConnectionIds: () => [],
    askTargetConnectionIds: () => [],
    ...overrides,
  });

  return { port, unchecked, checked };
}

describe('transport delivery port audiences', () => {
  test('origin audience sends through the unchecked connection send', () => {
    const { port, unchecked, checked } = makePort();
    const id = createConnectionId();
    const message: ServerMessage = { type: 'error', code: 'x', message: 'y' };

    port.sendToConnection(id, message);

    expect(unchecked).toEqual([{ id, message }]);
    expect(checked).toHaveLength(0);
  });

  test('global broadcast sends to every connection id in order and skips the excluded id', () => {
    const idA = createConnectionId();
    const idB = createConnectionId();
    const idC = createConnectionId();
    const message: ServerMessage = { type: 'session.created', session: { id: 's' } as never };

    const { port, checked } = makePort({
      connectionIds: () => [idA, idB, idC],
    });

    port.broadcast(message, idB);

    expect(checked.map((entry) => entry.id)).toEqual([idA, idC]);
    expect(checked.every((entry) => entry.message === message)).toBe(true);
  });

  test('session audience sends only to resolved participant connections', () => {
    const idA = createConnectionId();
    const idB = createConnectionId();
    const message: ServerMessage = { type: 'session.state', sessionId: 's', messages: [] };

    const { port, checked } = makePort({
      participantConnectionIds: (sessionId) => (sessionId === 's' ? [idA, idB] : []),
    });

    port.broadcastToSession('s', message, idA);
    port.broadcastToSession('other', message);

    expect(checked.map((entry) => entry.id)).toEqual([idB]);
  });

  test('controller audience sends only to resolved controller connections', () => {
    const idA = createConnectionId();
    const idB = createConnectionId();
    const message: ServerMessage = { type: 'session.control.updated', control: {} as never, reason: 'claimed' };

    const { port, checked, unchecked } = makePort({
      controllerConnectionIds: (sessionId) => (sessionId === 's' ? [idA, idB] : []),
    });

    port.sendToController('s', message);
    port.sendToController('other', message);

    expect(checked.map((entry) => entry.id)).toEqual([idA, idB]);
    expect(unchecked).toHaveLength(0);
  });

  test('ask-target audience resolves ids and sends through the unchecked send like the legacy path', () => {
    const idA = createConnectionId();
    const idB = createConnectionId();
    const message: ServerMessage = {
      type: 'ask.request',
      sessionId: 's',
      toolCallId: 'c',
      toolName: 'question',
      ask: { type: 'text', target: 'human', question: 'Continue?' },
      requestId: 'r',
      authority,
    };

    const { port, unchecked, checked } = makePort({
      askTargetConnectionIds: (sessionId, askAuthority) => {
        expect(sessionId).toBe('s');
        expect(askAuthority).toBe(authority);
        return [idA, idB];
      },
    });

    port.sendToAskTargets('s', authority, message);

    expect(unchecked.map((entry) => entry.id)).toEqual([idA, idB]);
    expect(checked).toHaveLength(0);
  });

  test('empty ask-target resolution falls back to controller connections with a checked send', () => {
    const controllerA = createConnectionId();
    const controllerB = createConnectionId();
    const message: ServerMessage = { type: 'error', code: 'x', message: 'y' };

    const { port, unchecked, checked } = makePort({
      controllerConnectionIds: (sessionId) => (sessionId === 's' ? [controllerA, controllerB] : []),
    });

    port.sendToAskTargets('s', authority, message);

    expect(unchecked).toHaveLength(0);
    expect(checked.map((entry) => entry.id)).toEqual([controllerA, controllerB]);
    expect(checked.every((entry) => entry.message === message)).toBe(true);
  });

  test('empty ask targets with no controller connections send nothing', () => {
    const message: ServerMessage = { type: 'error', code: 'x', message: 'y' };
    const { port, unchecked, checked } = makePort({
      controllerConnectionIds: () => [],
    });

    port.sendToAskTargets('s', authority, message);

    expect(unchecked).toHaveLength(0);
    expect(checked).toHaveLength(0);
  });

  test('empty resolution sends nothing for the global, session, and controller audiences', () => {
    const message: ServerMessage = { type: 'error', code: 'x', message: 'y' };
    const { port, unchecked, checked } = makePort();

    port.broadcast(message);
    port.broadcastToSession('s', message);
    port.sendToController('s', message);

    expect(unchecked).toHaveLength(0);
    expect(checked).toHaveLength(0);
  });
});
