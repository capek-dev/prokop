import type { RouterContext } from './router-context';
import type { ConnectionId } from './connection-id';
import { createWirePorts, requireWireApplication } from './application';
import type { SessionCompactMessage, SessionRevertMessage, SessionForkMessage } from '@prokopai/sdk';

/**
 * Compact, revert, and fork wire handlers (S3). Wire presentation only;
 * orchestration lives in the session transcript use cases.
 */
export async function handleSessionCompact(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionCompactMessage,
): Promise<void> {
  const wire = createWirePorts(ctx);
  await requireWireApplication().session.transcript.compact(wire, ws, msg.sessionId);
}

export async function handleSessionRevert(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionRevertMessage,
): Promise<void> {
  const wire = createWirePorts(ctx);
  await requireWireApplication().session.transcript.revert(wire, ws, {
    sessionId: msg.sessionId,
    messageId: msg.messageId,
  });
}

export async function handleSessionFork(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionForkMessage,
): Promise<void> {
  const wire = createWirePorts(ctx);
  await requireWireApplication().session.transcript.fork(wire, ws, {
    sessionId: msg.sessionId,
    messageId: msg.messageId,
    title: msg.title,
  });
}
