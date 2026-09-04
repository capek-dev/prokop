import type { ChatRetryMessage, CompactionCompleteMessage, ManagedWorktree, ProkopaiClient, SessionInterruptResult, SessionControlState } from '@prokopai/sdk';
import type { RefObject } from 'react';
import type { Session, Message, Part, MessageWithParts, PermissionGrant, QueuedMessage, Ask } from '@prokopai/sdk';
import type { SessionHandlersContext, SessionUsage } from '@/handlers/serverMessage';
import { sessionHandlers } from '@/handlers/serverMessage';
import { messagePartHandlers } from '@/handlers/serverMessage';
import { permissionQueueHandlers } from '@/handlers/serverMessage';
import { providerHandlers } from '@/handlers/serverMessage';
import { askHandlers } from '@/handlers/serverMessage';
import { controlHandlers } from '@/handlers/serverMessage';
import { worktreeHandlers } from '@/handlers/serverMessage';
import { useChatRetryStore } from '@/stores/chatRetryStore';
import { useConnectionStore } from '@/stores/connectionStore';

type CtxRef = RefObject<SessionHandlersContext | null>;

export function subscribeToServerEvents(
  client: ProkopaiClient,
  ctxRef: CtxRef,
): () => void {
  const ctx = () => ctxRef.current;
  const handlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

  function add(event: string, handler: (...args: unknown[]) => void) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on(event as any, handler as any);
    handlers.push({ event, handler });
  }

  add('session.created', (session: unknown) => {
    sessionHandlers['session.created']({ type: 'session.created', session: session as Session }, ctx()!);
  });
  add('session.resumed', (session: unknown, messages: unknown, usage: unknown, isRunning: unknown, control: unknown, transcript: unknown) => {
    if (!isRunning) {
      useChatRetryStore.getState().clearRetry((session as Session).id);
    }
    sessionHandlers['session.resumed'](
      {
        type: 'session.resumed',
        session: session as Session,
        messages: messages as MessageWithParts[] | undefined,
        usage: usage as SessionUsage | undefined,
        isRunning: isRunning as boolean | undefined,
        control: control as SessionControlState | undefined,
        transcript: transcript as {
          messages: MessageWithParts[];
          pagination: { hasOlder: boolean; oldestSequence: number | null; newestSequence: number | null; limit: number };
        } | undefined,
      },
      ctx()!,
    );
  });
  add('session.closed', (sessionId: unknown) => {
    useChatRetryStore.getState().clearRetry(sessionId as string);
    sessionHandlers['session.closed']({ type: 'session.closed', sessionId: sessionId as string }, ctx()!);
  });
  add('session.reopened', (session: unknown) => {
    sessionHandlers['session.reopened']({ type: 'session.reopened', session: session as Session }, ctx()!);
  });
  add('session.deleted', (sessionId: unknown) => {
    useChatRetryStore.getState().clearRetry(sessionId as string);
    sessionHandlers['session.deleted']({ type: 'session.deleted', sessionId: sessionId as string }, ctx()!);
  });
  add('session.updated', (session: unknown) => {
    sessionHandlers['session.updated']({ type: 'session.updated', session: session as Session }, ctx()!);
  });
  add('session.renamed', (session: unknown) => {
    sessionHandlers['session.renamed']({ type: 'session.renamed', session: session as Session }, ctx()!);
  });
  add('session.interrupted', (sessionId: unknown, result: unknown) => {
    useChatRetryStore.getState().clearRetry(sessionId as string);
    sessionHandlers['session.interrupted']({ type: 'session.interrupted', sessionId: sessionId as string, result: result as SessionInterruptResult }, ctx()!);
  });
  add('session.reverted', (sessionId: unknown, revertedTo: unknown, removed: unknown) => {
    sessionHandlers['session.reverted']({ type: 'session.reverted', sessionId: sessionId as string, revertedTo: revertedTo as { messageId: string | null; messageCount: number }, removed: removed as { messageIds: string[]; partCount: number } }, ctx()!);
  });
  add('session.forked', (originalSessionId: unknown, forkedSession: unknown, messages: unknown) => {
    sessionHandlers['session.forked']({ type: 'session.forked', originalSessionId: originalSessionId as string, forkedSession: forkedSession as Session, messages: messages as MessageWithParts[] }, ctx()!);
  });
  add('session.state', (sessionId: unknown, messages: unknown) => {
    sessionHandlers['session.state']({ type: 'session.state', sessionId: sessionId as string, messages: messages as MessageWithParts[] }, ctx()!);
  });
  add('worktree.updated', (worktree: unknown) => {
    worktreeHandlers['worktree.updated'](worktree as ManagedWorktree);
  });

  add('session.control.updated', (control: unknown, reason: unknown) => {
    controlHandlers['session.control.updated'](
      { type: 'session.control.updated', control: control as SessionControlState, reason: reason as import('@prokopai/sdk').SessionControlUpdateReason },
      ctx()!,
    );
  });

  add('session.action_rejected', (sessionId: unknown, action: unknown, code: unknown, message: unknown, control: unknown) => {
    controlHandlers['session.action_rejected'](
      { type: 'session.action_rejected', sessionId: sessionId as string, action: action as string, code: code as string, message: message as string, control: control as SessionControlState },
      ctx()!,
    );
  });

  add('message.created', (message: unknown) => {
    messagePartHandlers['message.created']({ type: 'message.created', message: message as Message }, ctx()!);
  });
  add('message.updated', (message: unknown) => {
    messagePartHandlers['message.updated']({ type: 'message.updated', message: message as Message }, ctx()!);
  });
  add('part.created', (sessionId: unknown, part: unknown) => {
    messagePartHandlers['part.created']({ type: 'part.created', sessionId: sessionId as string, part: part as Part }, ctx()!);
  });
  add('part.updated', (sessionId: unknown, part: unknown) => {
    messagePartHandlers['part.updated']({ type: 'part.updated', sessionId: sessionId as string, part: part as Part }, ctx()!);
  });
  add('part.append', (sessionId: unknown, partId: unknown, field: unknown, delta: unknown) => {
    messagePartHandlers['part.append']({ type: 'part.append', sessionId: sessionId as string, partId: partId as string, field: field as 'text' | 'reasoning', delta: delta as string }, ctx()!);
  });
  add('chat.usage', (sessionId: unknown, usage: unknown, model: unknown) => {
    messagePartHandlers['chat.usage']({ type: 'chat.usage', sessionId: sessionId as string, usage: usage as SessionUsage, model: model as string }, ctx()!);
  });
  add('chat.retry', (message: unknown) => {
    const retryMessage = message as ChatRetryMessage;
    useChatRetryStore.getState().applyRetry(retryMessage);
    if (retryMessage.status === 'scheduled' || retryMessage.status === 'started') {
      useConnectionStore.getState().addStreamingSession(retryMessage.sessionId);
    } else {
      useConnectionStore.getState().removeStreamingSession(retryMessage.sessionId);
    }
  });
  add('compaction.complete', (sessionId: unknown, tokensUsed: unknown) => {
    messagePartHandlers['compaction.complete']({ type: 'compaction.complete', sessionId: sessionId as string, tokensUsed: tokensUsed as CompactionCompleteMessage['tokensUsed'] }, ctx()!);
  });

  add('permission.list', (workspaceId: unknown, grants: unknown) => {
    permissionQueueHandlers['permission.list']({ type: 'permission.list', workspaceId: workspaceId as string, grants: grants as PermissionGrant[] }, ctx()!);
  });
  add('permission.revoked', (grantId: unknown) => {
    permissionQueueHandlers['permission.revoked']({ type: 'permission.revoked', grantId: grantId as string }, ctx()!);
  });
  add('permission.all_revoked', (workspaceId: unknown, count: unknown) => {
    permissionQueueHandlers['permission.all_revoked']({ type: 'permission.all_revoked', workspaceId: workspaceId as string, count: count as number }, ctx()!);
  });
  add('queue.list', (sessionId: unknown, messages: unknown) => {
    permissionQueueHandlers['queue.list']({ type: 'queue.list', sessionId: sessionId as string, messages: messages as QueuedMessage[] }, ctx()!);
  });
  add('queue.added', (sessionId: unknown, message: unknown) => {
    permissionQueueHandlers['queue.added']({ type: 'queue.added', sessionId: sessionId as string, message: message as QueuedMessage }, ctx()!);
  });
  add('queue.removed', (sessionId: unknown, queueId: unknown) => {
    permissionQueueHandlers['queue.removed']({ type: 'queue.removed', sessionId: sessionId as string, queueId: queueId as string }, ctx()!);
  });
  add('queue.sending', (sessionId: unknown, queueId: unknown) => {
    permissionQueueHandlers['queue.sending']({ type: 'queue.sending', sessionId: sessionId as string, queueId: queueId as string }, ctx()!);
  });

  add('provider.status', (provider: unknown, connected: unknown, authorizationUrl: unknown, error: unknown, reauthRequired: unknown) => {
    providerHandlers['provider.status']({ type: 'provider.status', provider: provider as string, connected: connected as boolean, authorizationUrl: authorizationUrl as string | undefined, error: error as string | undefined, reauthRequired: reauthRequired as boolean | undefined }, ctx()!);
  });
  add('provider.connected', (provider: unknown, connected: unknown, connectedAt: unknown, accountId: unknown) => {
    providerHandlers['provider.connected']({ type: 'provider.connected', provider: provider as string, connected: connected as boolean, connectedAt: connectedAt as string | undefined, accountId: accountId as string | undefined }, ctx()!);
  });

  add('ask.request', (sessionId: unknown, toolCallId: unknown, toolName: unknown, ask: unknown, requestId: unknown, authority: unknown) => {
    askHandlers['ask.request']({ type: 'ask.request', sessionId: sessionId as string, toolCallId: toolCallId as string, toolName: toolName as string, ask: ask as Ask, requestId: requestId as string | undefined, authority: authority as import('@prokopai/sdk').AskAuthority | undefined }, ctx()!);
  });
  add('ask.response_rejected', (sessionId: unknown, toolCallId: unknown, requestId: unknown, code: unknown, message: unknown) => {
    askHandlers['ask.response_rejected']({ type: 'ask.response_rejected', sessionId: sessionId as string, toolCallId: toolCallId as string, requestId: requestId as string | undefined, code: code as string, message: message as string }, ctx()!);
  });
  add('ask.timeout', (sessionId: unknown, toolCallId: unknown, requestId: unknown) => {
    askHandlers['ask.timeout']({ type: 'ask.timeout', sessionId: sessionId as string, toolCallId: toolCallId as string, requestId: requestId as string | undefined }, ctx()!);
  });
  add('ask.pending_sync', (sessionId: unknown, requests: unknown) => {
    askHandlers['ask.pending_sync']({ type: 'ask.pending_sync', sessionId: sessionId as string, requests: requests as Array<{ sessionId: string; toolCallId: string; toolName: string; ask: Ask; requestId?: string; _originSessionId?: string; authority?: import('@prokopai/sdk').AskAuthority }> }, ctx()!);
  });

  add('error', (code: unknown, message: unknown, sessionId: unknown) => {
    messagePartHandlers['error']({ type: 'error', code: code as string, message: message as string, sessionId: sessionId as string | undefined }, ctx()!);
  });

  return () => {
    for (const { event, handler } of handlers) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- required for TypedEventEmitter compatibility
      client.off(event as any, handler as any);
    }
  };
}
