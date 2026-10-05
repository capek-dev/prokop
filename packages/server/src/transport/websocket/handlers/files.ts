import type { RouterContext } from '@/transport/websocket/router-context';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { requireWireApplication } from '@/transport/websocket/application';
import type {
  FileTreeRefreshMessage,
  FileTreeSubscribeMessage,
  FileTreeUnsubscribeMessage,
} from '@prokopai/sdk';

export function handleFileTreeSubscribe(
  _ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: FileTreeSubscribeMessage,
): void {
  requireWireApplication().fileTree?.subscribe(ws, msg.workspaceId, msg.root);
}

export function handleFileTreeUnsubscribe(
  _ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: FileTreeUnsubscribeMessage,
): void {
  requireWireApplication().fileTree?.unsubscribe(ws, msg.workspaceId, msg.root);
}

export function handleFileTreeRefresh(
  _ctx: RouterContext<ConnectionId>,
  _ws: ConnectionId,
  msg: FileTreeRefreshMessage,
): void {
  requireWireApplication().fileTree?.refresh(msg.workspaceId, msg.root);
}
