import type { RouterContext } from '../router-context';
import type { ConnectionId } from '../connection-id';
import { requireWireApplication } from '../application';
import type { PermissionListRequestMessage, PermissionRevokeMessage, PermissionRevokeAllMessage } from '@jean2/sdk';

export function handlePermissionList(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: PermissionListRequestMessage,
): void {
  const grants = requireWireApplication().permissions.list(msg.workspaceId, { includeRevoked: msg.includeRevoked });
  ctx.send(ws, { type: 'permission.list', workspaceId: msg.workspaceId, grants });
}

export function handlePermissionRevoke(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: PermissionRevokeMessage,
): void {
  requireWireApplication().permissions.revoke(msg.grantId, null);
  ctx.send(ws, { type: 'permission.revoked', grantId: msg.grantId });
}

export function handlePermissionRevokeAll(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: PermissionRevokeAllMessage,
): void {
  const count = requireWireApplication().permissions.revokeAll(msg.workspaceId, null);
  ctx.send(ws, { type: 'permission.all_revoked', workspaceId: msg.workspaceId, count });
}
