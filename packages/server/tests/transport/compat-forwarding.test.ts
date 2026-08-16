import { afterEach, describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import type { AskAuthority, ServerMessage } from '@jean2/sdk';
import * as oldMessageRouter from '@/core/message-router';
import * as oldClientRegistry from '@/core/client-registry';
import * as oldSessionControl from '@/core/session-control-registry';
import * as oldChatHandler from '@/core/chat-handler';
import * as oldSessionHandler from '@/core/session-handler';
import * as oldRouterContext from '@/core/router-context';
import * as oldControlHandlers from '@/core/handlers/control';
import * as oldMiscHandlers from '@/core/handlers/misc';
import * as oldPermissionHandlers from '@/core/handlers/permissions';
import * as oldProviderHandlers from '@/core/handlers/providers';
import * as oldQueueHandlers from '@/core/handlers/queue';
import * as oldSessionLifecycleHandlers from '@/core/handlers/session-lifecycle';
import * as oldTerminal from '@/services/terminal';
import * as transportMessageRouter from '@/transport/websocket/message-router';
import * as transportClientRegistry from '@/transport/websocket/connection-registry';
import * as transportSessionControl from '@/transport/websocket/control-registry';
import * as transportChatHandler from '@/transport/websocket/chat-handler';
import * as transportSessionHandler from '@/transport/websocket/session-handler';
import * as transportRouterContext from '@/transport/websocket/router-context';
import * as transportControlHandlers from '@/transport/websocket/handlers/control';
import * as transportMiscHandlers from '@/transport/websocket/handlers/misc';
import * as transportPermissionHandlers from '@/transport/websocket/handlers/permissions';
import * as transportProviderHandlers from '@/transport/websocket/handlers/providers';
import * as transportQueueHandlers from '@/transport/websocket/handlers/queue';
import * as transportSessionLifecycleHandlers from '@/transport/websocket/handlers/session-lifecycle';
import * as transportTerminal from '@/transport/terminal';
import {
  broadcastEvent,
  broadcastSessionCreated,
  broadcastSessionCreatedExclude,
  broadcastSessionUpdated,
  broadcastToSessionEvent,
  installDeliveryPort,
  registerBroadcastCallback,
  registerBroadcastToSessionCallback,
  registerSendToAskTargetsCallback,
  registerSendToControllerCallback,
  sendToAskTargetsEvent,
  sendToControllerEvent,
  type DeliveryPort,
} from '@/core/broadcast';
import { unregisterConnection } from '@/transport/websocket/connection-registry';
import { removeSessionControl } from '@/transport/websocket/control-registry';
import { createConnectionId } from '@/transport/websocket/connection-id';

const sockets: unknown[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    unregisterConnection(socket);
  }
  removeSessionControl('s');
});

describe('S2 old-path forwarding', () => {
  test('core forwarding modules re-export the transport function identities', () => {
    expect(oldMessageRouter.handleClientMessage).toBe(transportMessageRouter.handleClientMessage);
    expect(oldChatHandler.handleChat).toBe(transportChatHandler.handleChat);
    expect(oldChatHandler.handleSessionEditMessage).toBe(transportChatHandler.handleSessionEditMessage);
    expect(oldChatHandler.regenerateSessionTitle).toBe(transportChatHandler.regenerateSessionTitle);
    expect(oldSessionHandler.handleSessionCompact).toBe(transportSessionHandler.handleSessionCompact);
    expect(oldSessionHandler.handleSessionRevert).toBe(transportSessionHandler.handleSessionRevert);
    expect(oldSessionHandler.handleSessionFork).toBe(transportSessionHandler.handleSessionFork);
    expect(oldRouterContext.sendGateRejection).toBe(transportRouterContext.sendGateRejection);
    expect(oldClientRegistry.getConnectionById).toBe(transportClientRegistry.getConnectionById);
    expect(oldClientRegistry.getAllClients).toBe(transportClientRegistry.getAllClients);
    expect(oldClientRegistry.getClientByClientId).toBe(transportClientRegistry.getClientByClientId);
    expect(oldSessionControl.buildControlUpdatedMessage).toBe(transportSessionControl.buildControlUpdatedMessage);
    expect(oldSessionControl.getControlState).toBe(transportSessionControl.getControlState);
    expect(oldSessionControl.sweepExpiredGrace).toBe(transportSessionControl.sweepExpiredGrace);
    expect(oldSessionControl.clearStaleTakeoverRequests).toBe(transportSessionControl.clearStaleTakeoverRequests);
  });

  test('wire handler forwarding modules re-export the transport handler identities', () => {
    expect(oldControlHandlers.handleClaimMessage).toBe(transportControlHandlers.handleClaimMessage);
    expect(oldControlHandlers.handleReleaseMessage).toBe(transportControlHandlers.handleReleaseMessage);
    expect(oldMiscHandlers.handleClientRegister).toBe(transportMiscHandlers.handleClientRegister);
    expect(oldMiscHandlers.handleAskResponse).toBe(transportMiscHandlers.handleAskResponse);
    expect(oldMiscHandlers.handlePong).toBe(transportMiscHandlers.handlePong);
    expect(oldPermissionHandlers.handlePermissionList).toBe(transportPermissionHandlers.handlePermissionList);
    expect(oldProviderHandlers.handleProviderConnect).toBe(transportProviderHandlers.handleProviderConnect);
    expect(oldQueueHandlers.handleQueueAdd).toBe(transportQueueHandlers.handleQueueAdd);
    expect(oldSessionLifecycleHandlers.handleCreateSession).toBe(transportSessionLifecycleHandlers.handleCreateSession);
    expect(oldSessionLifecycleHandlers.handleResumeSession).toBe(transportSessionLifecycleHandlers.handleResumeSession);
  });

  test('terminal forwarding keeps the singleton getters and frame codec identities', () => {
    expect(oldTerminal.getTerminalManager).toBe(transportTerminal.getTerminalManager);
    expect(oldTerminal.getTerminalEventManager).toBe(transportTerminal.getTerminalEventManager);
    expect(oldTerminal.encodeFrame).toBe(transportTerminal.encodeFrame);
    expect(oldTerminal.decodeFrame).toBe(transportTerminal.decodeFrame);
    expect(oldTerminal.OPCODES).toBe(transportTerminal.OPCODES);
  });

  test('socket-based registration through the old path is visible to the transport registry', () => {
    const socket = {} as ServerWebSocket;
    sockets.push(socket);
    const id = oldClientRegistry.registerConnection(socket);

    const conn = transportClientRegistry.getConnectionBySocket(socket);
    expect(String(conn?.connectionId)).toBe(id);
    expect(String(oldClientRegistry.getConnectionByWs(socket)?.connectionId)).toBe(id);
    expect(oldClientRegistry.getClientIdForWs(socket)).toBeNull();
    expect(oldClientRegistry.isClientRegistered(socket)).toBe(false);
  });

  test('socket-based control functions through the old path resolve the transport connection', () => {
    const socket = {} as ServerWebSocket;
    sockets.push(socket);
    oldClientRegistry.registerConnection(socket);
    oldClientRegistry.handleClientRegistration(socket, {
      type: 'client.register',
      client: {
        clientId: 'controller',
        clientType: 'web',
        displayName: 'Controller',
        interactionMode: 'human',
        capabilities: [],
      },
    }, () => {});

    const result = oldSessionControl.handleClaim('s', socket);
    expect(result.success).toBe(true);
    expect(oldSessionControl.getControlState('s').controllerClientId).toBe('controller');
  });
});

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
    registerSendToAskTargetsCallback(null as never);

    sendToControllerEvent('s', { type: 'error', code: 'a', message: 'b' });
    broadcastToSessionEvent('s', { type: 'error', code: 'c', message: 'd' });

    expect(messages).toHaveLength(2);
  });

  test('ask-target events fall back to controller delivery when no ask callback is registered', () => {
    const messages: ServerMessage[] = [];
    registerBroadcastCallback((message) => {
      messages.push(message);
    });
    registerSendToAskTargetsCallback(null as never);

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
