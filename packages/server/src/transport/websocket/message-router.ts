import type { ClientMessage } from '@prokopai/sdk';
import type { ConnectionId } from './connection-id';
import type { RouterContext } from './router-context';
import { handleChat, handleSessionEditMessage } from './chat-handler';
import { handleSessionCompact, handleSessionRevert, handleSessionFork } from './session-handler';

import { handleClaimMessage, handleReleaseMessage } from './handlers/control';
import {
  handleCreateSession,
  handleResumeSession,
  handleUpdateSession,
  handleUpdateModelSession,
  handleCloseSession,
  handleReopenSession,
  handleDeleteSession,
  handleRenameSession,
  handleGenerateTitleSession,
  handleInterruptSession,
} from './handlers/session-lifecycle';
import { handleQueueAdd, handleQueueRemove } from './handlers/queue';
import { handlePermissionList, handlePermissionRevoke, handlePermissionRevokeAll } from './handlers/permissions';
import { handleProviderConnect, handleProviderDisconnect } from './handlers/providers';
import {
  handleClientRegister,
  handlePong,
  handleNotificationAcknowledge,
  handleAskResponse,
  handleSandboxRespond,
} from './handlers/misc';

// Re-export for external consumers
export type { RouterContext, ClientEntry } from './router-context';

// Handler type

type Handler = (ctx: RouterContext<ConnectionId>, ws: ConnectionId, msg: ClientMessage) => Promise<void> | void;

// Chat handlers. The controller gate for chat.message and edit moved into
// the session application use cases in S3; these handlers only narrow the
// wire message and delegate.

async function handleChatMessage(ctx: RouterContext<ConnectionId>, ws: ConnectionId, msg: ClientMessage): Promise<void> {
  const chatMsg = msg as Extract<ClientMessage, { type: 'chat.message' }>;
  await handleChat(ctx, ws, chatMsg.sessionId, chatMsg.content, chatMsg.attachments, chatMsg.responseFormatId, chatMsg.goalCondition, chatMsg.goalMaxTurns);
}

async function handleEditMessage(ctx: RouterContext<ConnectionId>, ws: ConnectionId, msg: ClientMessage): Promise<void> {
  const editMsg = msg as Extract<ClientMessage, { type: 'session.edit_message' }>;
  await handleSessionEditMessage(ctx, ws, editMsg);
}

// Handler registry

// Cast a typed handler to the generic Handler type. The msg type is narrowed
// by the discriminator at dispatch time, but TS can't verify that statically.
function cast<M extends ClientMessage>(fn: (ctx: RouterContext<ConnectionId>, ws: ConnectionId, msg: M) => Promise<void> | void): Handler {
  return fn as Handler;
}

const handlers: Record<string, Handler> = {
  'client.register': cast(handleClientRegister),
  'session.control.claim': cast(handleClaimMessage),
  'session.control.release': cast(handleReleaseMessage),
  'session.create': cast(handleCreateSession),
  'session.resume': cast(handleResumeSession),
  'session.update': cast(handleUpdateSession),
  'session.update_model': cast(handleUpdateModelSession),
  'session.close': cast(handleCloseSession),
  'session.reopen': cast(handleReopenSession),
  'session.delete': cast(handleDeleteSession),
  'session.rename': cast(handleRenameSession),
  'session.generate_title': cast(handleGenerateTitleSession),
  'chat.message': cast(handleChatMessage),
  'permission.list': cast(handlePermissionList),
  'permission.revoke': cast(handlePermissionRevoke),
  'permission.revoke_all': cast(handlePermissionRevokeAll),
  'session.compact': cast(handleSessionCompact),
  'session.revert': cast(handleSessionRevert),
  'session.fork': cast(handleSessionFork),
  'session.edit_message': cast(handleEditMessage),
  'session.interrupt': cast(handleInterruptSession),
  'queue.add': cast(handleQueueAdd),
  'queue.remove': cast(handleQueueRemove),
  'provider.connect': cast(handleProviderConnect),
  'provider.disconnect': cast(handleProviderDisconnect),
  'notification.acknowledge': cast(handleNotificationAcknowledge),
  'pong': cast(handlePong),
  'ask.response': cast(handleAskResponse),
  'sandbox.respond': cast(handleSandboxRespond),
};

// Dispatcher

export async function handleClientMessage(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: ClientMessage,
): Promise<void> {
  const handler = handlers[msg.type];
  if (handler) {
    await handler(ctx, ws, msg);
  } else {
    ctx.send(ws, { type: 'error', code: 'unknown_message', message: 'Unknown message type' });
  }
}
