import type { ServerWebSocket } from 'bun';
import {
  getSession,
} from '@/store';
import {
  listLatestMessagesWithPartsPage,
} from '@/store';
import { executeCompaction, revertToStep, forkSession } from '@capekai/core/compat/jean2';
import type { RouterContext } from './router-context';
import type { SessionCompactMessage, SessionRevertMessage, SessionForkMessage } from '@jean2/sdk';

export async function handleSessionCompact(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: SessionCompactMessage,
): Promise<void> {
  const session = getSession(msg.sessionId);
  if (!session) {
    ctx.send(ws, { type: 'error', code: 'not_found', message: 'Session not found', sessionId: msg.sessionId });
    return;
  }

  const execResult = await executeCompaction(msg.sessionId, 'manual');

  if (execResult.ok) {
    ctx.send(ws, {
      type: 'compaction.complete',
      sessionId: msg.sessionId,
      tokensUsed: execResult.result.tokensUsed,
    });
  } else {
    if (execResult.skipped) {
      ctx.send(ws, { type: 'error', code: 'invalid_session', message: execResult.error, sessionId: msg.sessionId });
    } else {
      ctx.send(ws, { type: 'error', code: 'compaction_error', message: execResult.error, sessionId: msg.sessionId });
    }
  }
}

export async function handleSessionRevert(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: SessionRevertMessage,
): Promise<void> {
  try {
    const session = getSession(msg.sessionId);
    if (!session) {
      ctx.send(ws, { type: 'error', code: 'not_found', message: 'Session not found', sessionId: msg.sessionId });
      return;
    }

    const result = await revertToStep({
      sessionId: msg.sessionId,
      targetMessageId: msg.messageId,
    });

    ctx.broadcastToSession(msg.sessionId, {
      type: 'session.reverted',
      sessionId: msg.sessionId,
      revertedTo: result.revertedTo,
      removed: result.removed,
    });

    const currentState = listLatestMessagesWithPartsPage(msg.sessionId, 50);
    ctx.broadcastToSession(msg.sessionId, {
      type: 'session.state',
      sessionId: msg.sessionId,
      messages: currentState.messages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Revert failed';
    ctx.send(ws, { type: 'error', code: 'revert_error', message, sessionId: msg.sessionId });
  }
}

export async function handleSessionFork(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: SessionForkMessage,
): Promise<void> {
  try {
    const session = getSession(msg.sessionId);
    if (!session) {
      ctx.send(ws, { type: 'error', code: 'not_found', message: 'Session not found', sessionId: msg.sessionId });
      return;
    }

    const result = await forkSession({
      sessionId: msg.sessionId,
      targetMessageId: msg.messageId,
      title: msg.title,
    });

    const forkedPage = listLatestMessagesWithPartsPage(result.forkedSession.id, 50);
    ctx.broadcastToSession(msg.sessionId, {
      type: 'session.forked',
      originalSessionId: msg.sessionId,
      forkedSession: result.forkedSession,
      messages: forkedPage.messages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fork failed';
    ctx.send(ws, { type: 'error', code: 'fork_error', message, sessionId: msg.sessionId });
  }
}
