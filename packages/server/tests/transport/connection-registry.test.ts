import { afterEach, describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import type { ServerMessage } from '@jean2/sdk';
import {
  registerConnection,
  unregisterConnection,
  getConnectionBySocket,
  getConnectionById,
  getAllConnections,
  handleClientRegistration,
  getClientByClientId,
  getClientIdForSocket,
  isClientRegistered,
  touchConnection,
  getConnectionCount,
  getRegisteredClientCount,
  getConnectionsForClient,
  getAllConnectionsWithActiveSession,
} from '@/transport/websocket/connection-registry';

const sockets: unknown[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    unregisterConnection(socket);
  }
});

function fakeSocket(): ServerWebSocket {
  const socket = {} as ServerWebSocket;
  sockets.push(socket);
  return socket;
}

function registerDescriptor(
  socket: ServerWebSocket,
  clientId: string,
  capabilities: string[] = [],
  interactionMode: 'human' | 'headless' | 'hybrid' = 'human',
): ServerMessage[] {
  const sent: ServerMessage[] = [];
  handleClientRegistration(getConnectionBySocket(socket)!.connectionId, {
    type: 'client.register',
    client: {
      clientId,
      clientType: 'web',
      displayName: clientId,
      interactionMode,
      capabilities,
    },
  }, (_connectionId, message) => {
    sent.push(message);
  });
  return sent;
}

describe('transport connection registry', () => {
  test('registers connections under opaque ids that are never the socket itself', () => {
    const socketA = fakeSocket();
    const socketB = fakeSocket();

    const idA = registerConnection(socketA);
    const idB = registerConnection(socketB);

    expect(typeof idA).toBe('string');
    expect(idA).not.toBe(idB);
    expect(idA).not.toBe(socketA as unknown as string);
    expect(getConnectionCount()).toBe(2);

    expect(getConnectionBySocket(socketA)?.connectionId).toBe(idA);
    expect(getConnectionBySocket(socketB)?.connectionId).toBe(idB);
    expect(getConnectionById(idA)?.ws).toBe(socketA);
  });

  test('ids are not reused after unregister and register', () => {
    const socket = fakeSocket();
    const firstId = registerConnection(socket);
    unregisterConnection(socket);
    const secondId = registerConnection(socket);

    expect(secondId).not.toBe(firstId);
    expect(getConnectionCount()).toBe(1);
  });

  test('unregister removes the connection and keeps other connections', () => {
    const socketA = fakeSocket();
    const socketB = fakeSocket();
    registerConnection(socketA);
    const idB = registerConnection(socketB);

    unregisterConnection(socketA);

    expect(getConnectionBySocket(socketA)).toBeUndefined();
    expect(getConnectionById(idB)).toBeDefined();
    expect(getConnectionCount()).toBe(1);
  });

  test('rejects an invalid client descriptor with client.rejected', () => {
    const socket = fakeSocket();
    const id = registerConnection(socket);
    const sent: ServerMessage[] = [];
    handleClientRegistration(id, {
      type: 'client.register',
      client: {
        clientId: '',
        clientType: 'web',
        displayName: 'x',
        interactionMode: 'human',
        capabilities: [],
      },
    }, (_connectionId, message) => {
      sent.push(message);
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('client.rejected');
    expect((sent[0] as { code: string }).code).toBe('invalid_client');
    expect(getRegisteredClientCount()).toBe(0);
  });

  test('registers a client and reports the opaque connection id', () => {
    const socket = fakeSocket();
    const id = registerConnection(socket);
    const sent = registerDescriptor(socket, 'client-a', ['browser_tabs']);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('client.registered');
    expect((sent[0] as { connectionId: string }).connectionId).toBe(id);
    expect(getClientIdForSocket(socket)).toBe('client-a');
    expect(isClientRegistered(socket)).toBe(true);
    expect(getClientByClientId('client-a')?.capabilities).toEqual(['browser_tabs']);
  });

  test('merges connection ids for a client reconnecting on a second connection', () => {
    const socketA = fakeSocket();
    const socketB = fakeSocket();
    registerConnection(socketA);
    registerConnection(socketB);
    registerDescriptor(socketA, 'client-a');
    registerDescriptor(socketB, 'client-a');

    const client = getClientByClientId('client-a')!;
    expect(client.connectionIds.size).toBe(2);
    expect(getConnectionsForClient('client-a')).toHaveLength(2);

    unregisterConnection(socketA);
    expect(getClientByClientId('client-a')!.connectionIds.size).toBe(1);

    unregisterConnection(socketB);
    expect(getClientByClientId('client-a')).toBeUndefined();
    expect(getRegisteredClientCount()).toBe(0);
  });

  test('touchConnection updates connection and client lastSeenAt', () => {
    const socket = fakeSocket();
    registerConnection(socket);
    registerDescriptor(socket, 'client-a');

    const before = Date.now();
    touchConnection(socket);
    const after = Date.now();

    const conn = getConnectionBySocket(socket)!;
    expect(conn.lastSeenAt).toBeGreaterThanOrEqual(before);
    expect(conn.lastSeenAt).toBeLessThanOrEqual(after);
    expect(getClientByClientId('client-a')!.lastSeenAt).toBeGreaterThanOrEqual(before);
  });

  test('tracks active session ids per connection', () => {
    const socketA = fakeSocket();
    const socketB = fakeSocket();
    const idA = registerConnection(socketA);
    const idB = registerConnection(socketB);

    getConnectionById(idA)!.activeSessionIds.add('session-1');
    getConnectionById(idB)!.activeSessionIds.add('session-1');
    getConnectionById(idB)!.activeSessionIds.add('session-2');

    const sessionOne = getAllConnectionsWithActiveSession('session-1');
    expect(sessionOne.map((conn) => conn.connectionId).sort()).toEqual([idA, idB].sort());
    expect(getAllConnectionsWithActiveSession('session-2').map((conn) => conn.connectionId)).toEqual([idB]);
    expect(getAllConnections().length).toBe(2);
  });
});
