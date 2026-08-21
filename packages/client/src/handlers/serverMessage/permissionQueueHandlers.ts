import type { PermissionGrant, QueuedMessage } from '@prokopai/sdk';
import type { SessionHandlersContext } from './types';

export function handlePermissionList(
  msg: { type: 'permission.list'; workspaceId: string; grants: PermissionGrant[] },
  ctx: SessionHandlersContext,
): void {
  const { grants } = msg;
  const { setPermissions } = ctx;
  setPermissions(grants);
}

export function handlePermissionRevoked(
  msg: { type: 'permission.revoked'; grantId: string },
  ctx: SessionHandlersContext,
): void {
  const { grantId } = msg;
  const { setPermissions } = ctx;

  setPermissions(prev => prev.map(p =>
    p.id === grantId ? { ...p, revokedAt: new Date().toISOString() } : p
  ));
}

export function handlePermissionAllRevoked(
  msg: { type: 'permission.all_revoked'; workspaceId: string; count: number },
  ctx: SessionHandlersContext,
): void {
  const { setPermissions } = ctx;

  setPermissions(prev => {
    const now = new Date().toISOString();
    return prev.map(p => ({ ...p, revokedAt: now }));
  });
}

export function handleQueueList(
  msg: { type: 'queue.list'; sessionId: string; messages: QueuedMessage[] },
  ctx: SessionHandlersContext,
): void {
  const { sessionId, messages } = msg;
  const { setQueuedMessagesForSession } = ctx;
  setQueuedMessagesForSession(sessionId, messages);
}

export function handleQueueAdded(
  msg: { type: 'queue.added'; sessionId: string; message: QueuedMessage },
  ctx: SessionHandlersContext,
): void {
  const { sessionId, message } = msg;
  const { addQueuedMessage } = ctx;
  addQueuedMessage(sessionId, message);
}

export function handleQueueRemoved(
  msg: { type: 'queue.removed'; sessionId: string; queueId: string },
  ctx: SessionHandlersContext,
): void {
  const { sessionId, queueId } = msg;
  const { removeQueuedMessageById } = ctx;
  removeQueuedMessageById(sessionId, queueId);
}

export function handleQueueSending(
  msg: { type: 'queue.sending'; sessionId: string; queueId: string },
  ctx: SessionHandlersContext,
): void {
  const { sessionId, queueId } = msg;
  const { removeQueuedMessageById } = ctx;
  removeQueuedMessageById(sessionId, queueId);
}

export const permissionQueueHandlers = {
  'permission.list': handlePermissionList,
  'permission.revoked': handlePermissionRevoked,
  'permission.all_revoked': handlePermissionAllRevoked,
  'queue.list': handleQueueList,
  'queue.added': handleQueueAdded,
  'queue.removed': handleQueueRemoved,
  'queue.sending': handleQueueSending,
} as const;