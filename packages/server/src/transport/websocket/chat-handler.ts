import type { RouterContext } from './router-context';
import type { ConnectionId } from './connection-id';
import { createWirePorts, requireWireApplication } from './application';

/**
 * Chat, edit, and title regeneration wire handlers (S3).
 *
 * These handlers own wire presentation only: they derive the per-message
 * wire ports from the router context and delegate orchestration to the
 * session application use cases. The send and edit use cases gate the
 * controller and then invoke the exact Capek handleChat and
 * handleSessionEditMessage identities through the execution port.
 *
 * The Origin stays generic so the pre-S3 callers that pass socket-like
 * origins (and the old-path forwarders) keep working. Production dispatch
 * always supplies the opaque ConnectionId.
 */
export async function handleChat<Origin>(
  ctx: RouterContext<Origin>,
  ws: Origin,
  sessionId: string,
  content: string,
  attachments?: Array<{ id: string; kind: string }>,
  responseFormatId?: string,
  goalCondition?: string,
  goalMaxTurns?: number,
): Promise<void> {
  const wire = createWirePorts(ctx as unknown as RouterContext<ConnectionId>);
  await requireWireApplication().session.chat.sendMessage(
    wire,
    ws as unknown as ConnectionId,
    sessionId,
    content,
    attachments,
    responseFormatId,
    goalCondition,
    goalMaxTurns,
  );
}

export async function handleSessionEditMessage<Origin>(
  ctx: RouterContext<Origin>,
  ws: Origin,
  msg: { sessionId: string; messageId: string; content: string },
): Promise<void> {
  const wire = createWirePorts(ctx as unknown as RouterContext<ConnectionId>);
  await requireWireApplication().session.chat.editMessage(
    wire,
    ws as unknown as ConnectionId,
    msg,
  );
}

export async function regenerateSessionTitle<Origin>(
  ctx: RouterContext<Origin>,
  ws: Origin,
  sessionId: string,
  options?: { force?: boolean },
): Promise<void> {
  const wire = createWirePorts(ctx as unknown as RouterContext<ConnectionId>);
  requireWireApplication().session.chat.generateTitle(
    wire,
    ws as unknown as ConnectionId,
    sessionId,
    options?.force === true,
  );
}
