import type { RouterContext } from '@/transport/websocket/router-context';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { requireWireApplication } from '@/transport/websocket/application';
import type {
  GitStatusRefreshMessage,
  GitStatusSubscribeMessage,
  GitStatusUnsubscribeMessage,
} from '@prokopai/sdk';

export function handleGitStatusSubscribe(
  _ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: GitStatusSubscribeMessage,
): void {
  requireWireApplication().gitStatus?.subscribe(ws, msg.workspaceId, msg.root);
}

export function handleGitStatusUnsubscribe(
  _ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: GitStatusUnsubscribeMessage,
): void {
  requireWireApplication().gitStatus?.unsubscribe(ws, msg.workspaceId, msg.root);
}

export function handleGitStatusRefresh(
  _ctx: RouterContext<ConnectionId>,
  _ws: ConnectionId,
  msg: GitStatusRefreshMessage,
): void {
  requireWireApplication().gitStatus?.refresh(msg.workspaceId, msg.root);
}
