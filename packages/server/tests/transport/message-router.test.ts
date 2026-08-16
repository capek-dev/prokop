import { afterEach, describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import type { ClientMessage, ServerMessage } from '@jean2/sdk';
import { handleClientMessage } from '@/transport/websocket/message-router';
import type { ClientEntry, RouterContext } from '@/transport/websocket/router-context';
import {
  handleClientRegistration,
  registerConnection,
  unregisterConnection,
} from '@/transport/websocket/connection-registry';
import { removeSessionControl } from '@/transport/websocket/control-registry';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { installTestWireApplication } from '#tests/wire-application';

installTestWireApplication();

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

function makeContext() {
  const sent: ServerMessage[] = [];
  const broadcastToSession: ServerMessage[] = [];
  const broadcast: ServerMessage[] = [];
  const clients = new Map<ConnectionId, ClientEntry>();
  const ctx: RouterContext<ConnectionId> = {
    send: (_id, message) => {
      sent.push(message);
    },
    broadcast: (message) => {
      broadcast.push(message);
    },
    broadcastToSession: (_sessionId, message) => {
      broadcastToSession.push(message);
    },
    sendToController: () => {},
    sendToAskTargets: () => {},
    clients,
  };
  return { ctx, sent, broadcastToSession, broadcast, clients };
}

function registerClient(clientId: string): ConnectionId {
  const socket = {} as ServerWebSocket;
  sockets.push(socket);
  const connectionId = registerConnection(socket);
  handleClientRegistration(connectionId, {
    type: 'client.register',
    client: {
      clientId,
      clientType: 'web',
      displayName: clientId,
      interactionMode: 'human',
      capabilities: [],
    },
  }, () => {});
  return connectionId;
}

describe('transport message router dispatch', () => {
  test('unknown message types map to the unknown_message error', async () => {
    const { ctx, sent } = makeContext();
    const connectionId = registerClient('client-a');

    await handleClientMessage(ctx, connectionId, { type: 'unknown.type' } as unknown as ClientMessage);

    expect(sent).toEqual([{ type: 'error', code: 'unknown_message', message: 'Unknown message type' }]);
  });

  test('pong resets the missed ping bookkeeping for the connection', async () => {
    const { ctx, clients } = makeContext();
    const connectionId = registerClient('client-a');
    clients.set(connectionId, { sessionIds: new Set(), missedPings: 3 });

    await handleClientMessage(ctx, connectionId, { type: 'pong' });

    expect(clients.get(connectionId)?.missedPings).toBe(0);
  });

  test('claim dispatches to the controller registry and broadcasts control updates', async () => {
    const { ctx, broadcastToSession } = makeContext();
    const connectionId = registerClient('controller');
    sessions.push('session-1');

    await handleClientMessage(ctx, connectionId, {
      type: 'session.control.claim',
      sessionId: 'session-1',
    });

    expect(broadcastToSession).toHaveLength(1);
    const update = broadcastToSession[0] as { type: string; reason: string; control: { status: string } };
    expect(update.type).toBe('session.control.updated');
    expect(update.reason).toBe('claimed');
    expect(update.control.status).toBe('controlled');
  });

  test('claim by an unregistered connection returns the registration error', async () => {
    const { ctx, sent, broadcastToSession } = makeContext();
    const socket = {} as ServerWebSocket;
    sockets.push(socket);
    const connectionId = registerConnection(socket);
    sessions.push('session-1');

    await handleClientMessage(ctx, connectionId, {
      type: 'session.control.claim',
      sessionId: 'session-1',
    });

    expect(sent).toEqual([
      {
        type: 'error',
        code: 'registration_required',
        message: 'Client must be registered before claiming control',
      },
    ]);
    expect(broadcastToSession).toHaveLength(0);
  });
});
