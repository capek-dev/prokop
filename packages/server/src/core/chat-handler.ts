import {
  handleChat as handleCapekChat,
  handleSessionEditMessage as handleCapekSessionEditMessage,
  regenerateSessionTitle as regenerateCapekSessionTitle,
} from '@capekai/core/compat/jean2';
import type { ServerWebSocket } from 'bun';
import { createJean2RuntimeContext } from '@/capek-event-adapter';
import type { RouterContext } from '@/core/router-context';

function createRuntimeContext(ctx: RouterContext) {
  return createJean2RuntimeContext<ServerWebSocket>({
    send: ctx.send,
    broadcast: ctx.broadcast,
    broadcastToSession: ctx.broadcastToSession,
    sendToController: ctx.sendToController,
    sendToAskTargets: ctx.sendToAskTargets,
    attachOriginToSession(origin, sessionId) {
      const existing = ctx.clients.get(origin);
      if (existing) {
        existing.sessionIds.add(sessionId);
      } else {
        ctx.clients.set(origin, { sessionIds: new Set([sessionId]), missedPings: 0 });
      }
    },
  });
}

export async function handleChat(
  ctx: RouterContext,
  ws: ServerWebSocket,
  sessionId: string,
  content: string,
  attachments?: Array<{ id: string; kind: string }>,
  responseFormatId?: string,
  goalCondition?: string,
  goalMaxTurns?: number,
): Promise<void> {
  await handleCapekChat(
    createRuntimeContext(ctx),
    ws,
    sessionId,
    content,
    attachments,
    responseFormatId,
    goalCondition,
    goalMaxTurns,
  );
}

export async function handleSessionEditMessage(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: { sessionId: string; messageId: string; content: string },
): Promise<void> {
  await handleCapekSessionEditMessage(createRuntimeContext(ctx), ws, msg);
}

export async function regenerateSessionTitle(
  ctx: RouterContext,
  ws: ServerWebSocket,
  sessionId: string,
  options?: { force?: boolean },
): Promise<void> {
  await regenerateCapekSessionTitle(createRuntimeContext(ctx), ws, sessionId, options);
}

export type { ClientEntry as Jean2RouterClientEntry, RouterContext as Jean2RouterContext } from '@/core/router-context';
