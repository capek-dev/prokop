import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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
import { getSession, listQueuedMessages } from '@/store';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';
import { seedWorkspaceWithSession } from '#tests/seed';
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

describe('S3 session wire handler integration contract', () => {
  let sessionId: string;
  let workspaceId: string;

  beforeEach(() => {
    setupTestDataDir();
    setupTestDatabase();
    const seeded = seedWorkspaceWithSession();
    sessionId = seeded.sessionId;
    workspaceId = seeded.workspaceId;
  });

  afterEach(() => {
    resetTestDatabase();
    resetTestDataDir();
  });

  test('session.create persists the session and delivers send then broadcast', async () => {
    const { ctx, sent, broadcast } = makeContext();
    const connectionId = registerClient('creator');

    await handleClientMessage(ctx, connectionId, {
      type: 'session.create',
      workspaceId,
    } as ClientMessage);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('session.created');
    const created = (sent[0] as { session: { id: string; workspaceId: string } }).session;
    expect(created.workspaceId).toBe(workspaceId);
    expect(getSession(created.id)).toBeDefined();
    expect(broadcast).toEqual(sent);
  });

  test('session.rename trims the title, marks it manual, and broadcasts to the session', async () => {
    const { ctx, broadcastToSession } = makeContext();
    const connectionId = registerClient('renamer');

    await handleClientMessage(ctx, connectionId, {
      type: 'session.rename',
      sessionId,
      title: '  Renamed by wire  ',
    } as ClientMessage);

    expect(broadcastToSession).toHaveLength(1);
    expect(broadcastToSession[0]).toMatchObject({ type: 'session.renamed' });
    const stored = getSession(sessionId);
    expect(stored?.title).toBe('Renamed by wire');
    expect((stored?.metadata as Record<string, unknown>)?.titleManuallyRenamed).toBe(true);
  });

  test('queue.add enqueues, attaches the origin, and reports queue.added', async () => {
    const { ctx, sent, clients } = makeContext();
    const connectionId = registerClient('queuer');

    await handleClientMessage(ctx, connectionId, {
      type: 'queue.add',
      sessionId,
      content: 'Wire queued',
    } as ClientMessage);

    expect(sent).toEqual([expect.objectContaining({ type: 'queue.added', sessionId })]);
    expect(listQueuedMessages(sessionId).map((m) => m.content)).toEqual(['Wire queued']);
    expect(clients.get(connectionId)?.sessionIds.has(sessionId)).toBe(true);
  });

  test('queue.remove deletes the queued message and reports queue.removed', async () => {
    const { ctx, sent } = makeContext();
    const connectionId = registerClient('dequeuer');
    const queued = listQueuedMessages(sessionId);

    await handleClientMessage(ctx, connectionId, {
      type: 'queue.add',
      sessionId,
      content: 'To remove',
    } as ClientMessage);
    const added = (sent[0] as { message: { id: string } }).message;

    sent.length = 0;
    await handleClientMessage(ctx, connectionId, {
      type: 'queue.remove',
      queueId: added.id,
    } as ClientMessage);

    expect(sent).toEqual([{ type: 'queue.removed', sessionId, queueId: added.id }]);
    expect(listQueuedMessages(sessionId)).toEqual(queued);
  });

  test('session.update_model persists the selection and sends session.updated', async () => {
    const { ctx, sent } = makeContext();
    const connectionId = registerClient('modeler');

    await handleClientMessage(ctx, connectionId, {
      type: 'session.update_model',
      sessionId,
      modelId: 'gpt-5',
      providerId: 'openai',
    } as ClientMessage);

    expect(sent).toEqual([expect.objectContaining({ type: 'session.updated' })]);
    const stored = getSession(sessionId);
    expect(stored?.selectedModel).toBe('gpt-5');
    expect(stored?.selectedProvider).toBe('openai');
  });

  test('session.close and session.reopen flip the status through the use case', async () => {
    const { ctx, sent } = makeContext();
    const connectionId = registerClient('closer');

    await handleClientMessage(ctx, connectionId, {
      type: 'session.close',
      sessionId,
    } as ClientMessage);
    expect(getSession(sessionId)?.status).toBe('closed');
    expect(sent).toEqual([{ type: 'session.closed', sessionId }]);

    sent.length = 0;
    await handleClientMessage(ctx, connectionId, {
      type: 'session.reopen',
      sessionId,
    } as ClientMessage);
    expect(getSession(sessionId)?.status).toBe('active');
    expect(sent).toEqual([expect.objectContaining({ type: 'session.reopened' })]);
  });

  test('session.delete removes the session and reports session.deleted', async () => {
    const { ctx, sent } = makeContext();
    const connectionId = registerClient('deleter');

    await handleClientMessage(ctx, connectionId, {
      type: 'session.delete',
      sessionId,
    } as ClientMessage);

    expect(getSession(sessionId)).toBeNull();
    expect(sent).toEqual([{ type: 'session.deleted', sessionId }]);
  });

  test('session.generate_title for a missing session reports not_found with the sessionId', async () => {
    const { ctx, sent } = makeContext();
    const connectionId = registerClient('titler');

    await handleClientMessage(ctx, connectionId, {
      type: 'session.generate_title',
      sessionId: 'missing-session',
    } as ClientMessage);

    expect(sent).toEqual([{
      type: 'error',
      code: 'not_found',
      message: 'Session not found',
      sessionId: 'missing-session',
    }]);
  });

  test('resume returns the session state through the use case', async () => {
    const { ctx, sent } = makeContext();
    const connectionId = registerClient('resumer');

    await handleClientMessage(ctx, connectionId, {
      type: 'session.resume',
      sessionId,
    } as ClientMessage);

    expect(sent[0]).toMatchObject({ type: 'session.resumed', session: expect.objectContaining({ id: sessionId }) });
    const sync = sent.find((m) => m.type === 'ask.pending_sync');
    expect(sync).toBeDefined();
  });
});
