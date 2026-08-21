import { afterEach, describe, expect, test } from 'bun:test';
import type { AskAuthority, AskResponse, ServerMessage } from '@prokopai/sdk';
import type { ClientMessage } from '@prokopai/sdk';
import {
  handleAskResponseWithDependencies,
  handleNotificationAcknowledge,
  type AskResponseDependencies,
} from '@/transport/websocket/handlers/misc';
import { installWireApplication } from '@/transport/websocket/application';
import {
  handleClientRegistration,
  registerConnection,
  unregisterConnection,
} from '@/transport/websocket/connection-registry';
import { handleClaim, removeSessionControl } from '@/transport/websocket/control-registry';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import type { ClientEntry, RouterContext } from '@/transport/websocket/router-context';

// ---------------------------------------------------------------------------
// The authority matrix below drives the moved ask.response handler through the
// real transport handler, the real connection and controller registries, and
// the real capability-router eligibility policy. Only the Capek pending-ask lookup and
// resolution entrypoint is simulated, so designated and first-eligible
// authorities (which current ask producers do not emit) are reachable.
//
// Dependencies are local to this file, so concurrent real-machinery suites
// keep the real runtime without process-wide module mock interference.
// ---------------------------------------------------------------------------

const askState = {
  sessionByTool: new Map<string, string>(),
  authorityByTool: new Map<string, AskAuthority>(),
  resolveCalls: [] as Array<{ toolCallId: string; response: unknown; requestId?: string }>,
};

const askDependencies: AskResponseDependencies = {
  resolveAsk: async (toolCallId, response, requestId) => {
    askState.resolveCalls.push({ toolCallId, response, requestId });
    return false;
  },
  getSessionIdForPendingAsk: async (toolCallId) =>
    askState.sessionByTool.get(toolCallId) ?? null,
  getAuthorityForPendingAsk: (toolCallId) =>
    askState.authorityByTool.get(toolCallId),
};

// handleNotificationAcknowledge delegates to the wired notifications
// application (S3). Acknowledge delegation is covered by
// notification-ack-handler.test.ts; here a neutral application keeps the
// handler from throwing when no suite has installed one yet.
installWireApplication({
  session: {} as never,
  control: {} as never,
  providers: {} as never,
  notifications: { acknowledgePendingNotification: () => false } as never,
  permissions: {} as never,
});

const sockets: unknown[] = [];

const controllerOnly: AskAuthority = {
  visibilityScope: 'controller_only',
  resolutionMode: 'controller_only',
};

const designated: AskAuthority = {
  visibilityScope: 'session_participants',
  resolutionMode: 'designated_clients',
  allowedResponderClientIds: ['designated'],
  requiredCapabilities: ['browser_tabs'],
};

const firstEligible: AskAuthority = {
  visibilityScope: 'session_participants',
  resolutionMode: 'first_eligible',
  requiredCapabilities: ['browser_tabs'],
};

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    unregisterConnection(socket);
  }
  removeSessionControl('session-1');
  askState.sessionByTool.clear();
  askState.authorityByTool.clear();
  askState.resolveCalls.length = 0;
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

function registerUnregisteredConnection(): ConnectionId {
  const socket = {};
  sockets.push(socket);
  return registerConnection(socket);
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

async function dispatch(
  ctx: RouterContext<ConnectionId>,
  sender: ConnectionId,
  toolCallId: string,
  response: AskResponse,
  requestId?: string,
): Promise<void> {
  const msg: ClientMessage = {
    type: 'ask.response',
    toolCallId,
    response,
    requestId,
  };
  await handleAskResponseWithDependencies(ctx, sender, msg, askDependencies);
}

function rejection(sent: ServerMessage[]): Extract<ServerMessage, { type: 'ask.response_rejected' }> {
  return sent[sent.length - 1] as Extract<ServerMessage, { type: 'ask.response_rejected' }>;
}

describe('transport ask.response authority routing', () => {
  test('a registered controller resolves an ask under controller-only authority', async () => {
    const controllerId = registerClient('controller');
    const { ctx, sent } = makeContext();
    handleClaim('session-1', controllerId);
    askState.sessionByTool.set('call-1', 'session-1');
    askState.authorityByTool.set('call-1', controllerOnly);

    await dispatch(ctx, controllerId, 'call-1', { type: 'text', value: 'Jean' }, 'match-1');

    expect(askState.resolveCalls).toEqual([
      { toolCallId: 'call-1', response: { type: 'text', value: 'Jean' }, requestId: 'match-1' },
    ]);
    expect(sent).toEqual([]);
  });

  test('an eligible designated participant resolves an ask where authority permits it', async () => {
    const controllerId = registerClient('controller');
    const designatedId = registerClient('designated', ['browser_tabs']);
    const { ctx, sent } = makeContext();
    handleClaim('session-1', controllerId);
    askState.sessionByTool.set('call-2', 'session-1');
    askState.authorityByTool.set('call-2', designated);

    await dispatch(ctx, designatedId, 'call-2', { type: 'text', value: 'Yes' });

    expect(askState.resolveCalls).toEqual([
      { toolCallId: 'call-2', response: { type: 'text', value: 'Yes' }, requestId: undefined },
    ]);
    expect(sent).toEqual([]);
  });

  test('an eligible first-eligible participant resolves an ask where authority permits it', async () => {
    const controllerId = registerClient('controller');
    const capableId = registerClient('capable', ['browser_tabs']);
    const { ctx, sent } = makeContext();
    handleClaim('session-1', controllerId);
    askState.sessionByTool.set('call-3', 'session-1');
    askState.authorityByTool.set('call-3', firstEligible);

    await dispatch(ctx, capableId, 'call-3', {
      type: 'client_capability',
      capability: 'browser_tabs',
      result: { tabs: 2 },
    });

    expect(askState.resolveCalls).toEqual([
      {
        toolCallId: 'call-3',
        response: { type: 'client_capability', capability: 'browser_tabs', result: { tabs: 2 } },
        requestId: undefined,
      },
    ]);
    expect(sent).toEqual([]);
  });

  test('an ineligible designated participant is denied with the unchanged not_controller code', async () => {
    const controllerId = registerClient('controller');
    const otherId = registerClient('other');
    const { ctx, sent } = makeContext();
    handleClaim('session-1', controllerId);
    askState.sessionByTool.set('call-2', 'session-1');
    askState.authorityByTool.set('call-2', designated);

    await dispatch(ctx, otherId, 'call-2', { type: 'text', value: 'Yes' });

    expect(askState.resolveCalls).toEqual([]);
    expect(rejection(sent)).toMatchObject({
      type: 'ask.response_rejected',
      sessionId: 'session-1',
      toolCallId: 'call-2',
      code: 'not_controller',
      message: 'You are not an allowed responder for this ask',
    });
  });

  test('an ineligible first-eligible responder is denied with the unchanged not_controller code', async () => {
    const controllerId = registerClient('controller');
    const otherId = registerClient('other');
    const { ctx, sent } = makeContext();
    handleClaim('session-1', controllerId);
    askState.sessionByTool.set('call-3', 'session-1');
    askState.authorityByTool.set('call-3', firstEligible);

    await dispatch(ctx, otherId, 'call-3', { type: 'text', value: 'Yes' });

    expect(askState.resolveCalls).toEqual([]);
    expect(rejection(sent)).toMatchObject({
      type: 'ask.response_rejected',
      sessionId: 'session-1',
      toolCallId: 'call-3',
      code: 'not_controller',
      message: 'Your client does not have the required capabilities for this ask',
    });
  });

  test('the controller itself is denied with not_allowed when it lacks required capabilities', async () => {
    const controllerId = registerClient('controller');
    const { ctx, sent } = makeContext();
    handleClaim('session-1', controllerId);
    askState.sessionByTool.set('call-3', 'session-1');
    askState.authorityByTool.set('call-3', firstEligible);

    await dispatch(ctx, controllerId, 'call-3', { type: 'text', value: 'Yes' });

    expect(askState.resolveCalls).toEqual([]);
    expect(rejection(sent)).toMatchObject({
      type: 'ask.response_rejected',
      sessionId: 'session-1',
      toolCallId: 'call-3',
      code: 'not_allowed',
      message: 'Your client does not have the required capabilities for this ask',
    });
  });

  test('an unregistered sender on a controlled session is denied with not_allowed', async () => {
    const controllerId = registerClient('controller');
    const unregisteredId = registerUnregisteredConnection();
    const { ctx, sent } = makeContext();
    handleClaim('session-1', controllerId);
    askState.sessionByTool.set('call-1', 'session-1');
    askState.authorityByTool.set('call-1', controllerOnly);

    await dispatch(ctx, unregisteredId, 'call-1', { type: 'text', value: 'Jean' });

    expect(askState.resolveCalls).toEqual([]);
    expect(rejection(sent)).toMatchObject({
      type: 'ask.response_rejected',
      sessionId: 'session-1',
      toolCallId: 'call-1',
      code: 'not_allowed',
      message: 'Client must be registered to respond to asks',
    });
  });


  test('notification acknowledgement resolves the client id from the opaque connection id', async () => {
    const acks: Array<{ eventId: string; sessionId: string; clientId: string }> = [];
    installWireApplication({
      session: {} as never,
      control: {} as never,
      providers: {} as never,
      notifications: {
        acknowledgePendingNotification: (eventId: string, sessionId: string, clientId: string) => {
          acks.push({ eventId, sessionId, clientId });
          return true;
        },
      } as never,
      permissions: {} as never,
    });

    const clientAId = registerClient('client-a');
    const unregisteredId = registerUnregisteredConnection();
    const { ctx, sent } = makeContext();

    handleNotificationAcknowledge(ctx, clientAId, {
      type: 'notification.acknowledge',
      eventId: 'evt-1',
      sessionId: 'session-1',
    });
    expect(acks).toEqual([
      { eventId: 'evt-1', sessionId: 'session-1', clientId: 'client-a' },
    ]);

    handleNotificationAcknowledge(ctx, unregisteredId, {
      type: 'notification.acknowledge',
      eventId: 'evt-2',
      sessionId: 'session-1',
    });
    expect(acks).toHaveLength(1);
    expect(sent).toEqual([]);
  });
});
