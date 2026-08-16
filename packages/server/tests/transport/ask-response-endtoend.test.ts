import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerMessage } from '@jean2/sdk';
import {
  createAskApi,
  hasPendingAsk,
  rejectPendingAsksByToolCallId,
} from '@capekai/core/compat/jean2';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { resetTestDataDir, setupTestDataDir } from '#tests/test-dir';
import { handleClientMessage } from '@/transport/websocket/message-router';
import {
  handleClientRegistration,
  registerConnection,
  unregisterConnection,
} from '@/transport/websocket/connection-registry';
import { handleClaim, removeSessionControl } from '@/transport/websocket/control-registry';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import type { ClientEntry, RouterContext } from '@/transport/websocket/router-context';

const sockets: unknown[] = [];
let sessionId = '';

beforeEach(() => {
  setupTestDataDir();
  setupTestDatabase();
  sessionId = seedWorkspaceWithSession().sessionId;
});

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    unregisterConnection(socket);
  }
  removeSessionControl(sessionId);
  resetTestDatabase();
  resetTestDataDir();
});

function registerClient(clientId: string, capabilities: string[] = []): ConnectionId {
  const socket = {};
  sockets.push(socket);
  const connectionId = registerConnection(socket);
  handleClientRegistration(connectionId, {
    type: 'client.register',
    client: {
      clientId,
      clientType: 'web',
      displayName: clientId,
      interactionMode: 'human',
      capabilities,
    },
  }, () => {});
  return connectionId;
}

function makeContext() {
  const sent: ServerMessage[] = [];
  const clients = new Map<ConnectionId, ClientEntry>();
  const ctx: RouterContext<ConnectionId> = {
    send: (_id, message) => {
      sent.push(message);
    },
    broadcast: () => {},
    broadcastToSession: () => {},
    sendToController: () => {},
    sendToAskTargets: () => {},
    clients,
  };
  return { ctx, sent };
}

describe('transport ask.response end to end with the real pending-ask machinery', () => {
  test('a registered controller answers a real pending ask through the router', async () => {
    const controllerId = registerClient('controller');
    const { ctx, sent } = makeContext();
    handleClaim(sessionId, controllerId);

    const askApi = createAskApi(sessionId, 'call-1', 'question', () => {});
    const values: unknown[] = [];
    const promise = askApi({ type: 'text', question: 'Continue?', target: 'human' }).then((value) => {
      values.push(value);
    });

    await handleClientMessage(ctx, controllerId, {
      type: 'ask.response',
      toolCallId: 'call-1',
      response: { type: 'text', value: 'Jean' },
    });
    await promise;

    expect(values).toEqual(['Jean']);
    expect(hasPendingAsk('call-1')).toBe(false);
    expect(sent).toEqual([]);
  });

  test('an eligible first-eligible participant answers a real capability ask through the router', async () => {
    const controllerId = registerClient('controller');
    const capableId = registerClient('capable', ['browser_tabs']);
    const { ctx, sent } = makeContext();
    handleClaim(sessionId, controllerId);

    const askApi = createAskApi(sessionId, 'call-2', 'capability-tool', () => {});
    const promise = askApi({ type: 'client_capability', capability: 'browser_tabs', target: 'client' });

    await handleClientMessage(ctx, capableId, {
      type: 'ask.response',
      toolCallId: 'call-2',
      response: { type: 'client_capability', capability: 'browser_tabs', result: { tabs: 3 } },
    });

    await expect(promise).resolves.toEqual({ tabs: 3 });
    expect(sent).toEqual([]);
  });

  test('an ineligible client is denied with the unchanged rejection shape', async () => {
    const controllerId = registerClient('controller');
    const otherId = registerClient('other');
    const { ctx, sent } = makeContext();
    handleClaim(sessionId, controllerId);

    const askApi = createAskApi(sessionId, 'call-3', 'capability-tool', () => {});
    const promise = askApi({ type: 'client_capability', capability: 'browser_tabs', target: 'client' })
      .then(() => {})
      .catch(() => {});

    await handleClientMessage(ctx, otherId, {
      type: 'ask.response',
      toolCallId: 'call-3',
      response: { type: 'client_capability', capability: 'browser_tabs', result: null },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'ask.response_rejected',
      sessionId,
      toolCallId: 'call-3',
      code: 'not_controller',
      message: 'Your client does not have the required capabilities for this ask',
    });
    expect(hasPendingAsk('call-3')).toBe(true);

    rejectPendingAsksByToolCallId('call-3');
    await promise;
  });

  test('unknown ask responses deny through the existing resolution path without a wire message', async () => {
    const controllerId = registerClient('controller');
    const { ctx, sent } = makeContext();
    handleClaim(sessionId, controllerId);

    let resolved = false;
    const askApi = createAskApi(sessionId, 'call-4', 'question', () => {});
    const promise = askApi({ type: 'text', question: 'Continue?', target: 'human' })
      .then(() => {
        resolved = true;
      })
      .catch(() => {});

    await handleClientMessage(ctx, controllerId, {
      type: 'ask.response',
      toolCallId: 'missing-call',
      response: { type: 'text', value: 'nope' },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(sent).toEqual([]);
    expect(resolved).toBe(false);
    expect(hasPendingAsk('call-4')).toBe(true);

    rejectPendingAsksByToolCallId('call-4');
    await promise;
  });
});
