import type { RouterContext } from '../router-context';
import type { ConnectionId } from '../connection-id';
import { createWirePorts, requireWireApplication } from '../application';
import type { QueueAddMessage, QueueRemoveMessage } from '@prokopai/sdk';

/**
 * Queue wire handlers (S3). Wire presentation only; the queue add and
 * remove orchestration (session and content checks, controller gate, and
 * delivery order) lives in the session queue use cases.
 */
export function handleQueueAdd(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: QueueAddMessage,
): void {
  const wire = createWirePorts(ctx);
  requireWireApplication().session.queue.add(wire, ws, {
    sessionId: msg.sessionId,
    content: msg.content,
    attachments: msg.attachments,
  });
}

export function handleQueueRemove(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: QueueRemoveMessage,
): void {
  const wire = createWirePorts(ctx);
  requireWireApplication().session.queue.remove(wire, ws, msg.queueId);
}
