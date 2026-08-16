import type { RouterContext } from '../router-context';
import type { ConnectionId } from '../connection-id';
import { getWorkspaceGrants, revokeGrant, revokeAllWorkspaceGrants } from '@/store/permissions';
import type { PermissionListRequestMessage, PermissionRevokeMessage, PermissionRevokeAllMessage } from '@jean2/sdk';

export function handlePermissionList(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: PermissionListRequestMessage,
): void {
  const grants = getWorkspaceGrants(msg.workspaceId, { includeRevoked: msg.includeRevoked });
  ctx.send(ws, { type: 'permission.list', workspaceId: msg.workspaceId, grants });
}

export function handlePermissionRevoke(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: PermissionRevokeMessage,
): void {
  revokeGrant(msg.grantId, null);
  ctx.send(ws, { type: 'permission.revoked', grantId: msg.grantId });
}

export function handlePermissionRevokeAll(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: PermissionRevokeAllMessage,
): void {
  const count = revokeAllWorkspaceGrants(msg.workspaceId, null);
  ctx.send(ws, { type: 'permission.all_revoked', workspaceId: msg.workspaceId, count });
}
