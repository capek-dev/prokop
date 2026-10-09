import { create } from 'zustand';
import {
  AuthError,
  ProkopaiClient,
  type Message,
  type MessageWithParts,
  type Part,
  type QueuedMessage,
  type SavedServer,
  type Session,
} from '@prokopai/sdk';
import type { SessionHandlersContext } from '@/handlers/serverMessage';
import {
  askHandlers,
  controlHandlers,
  messagePartHandlers,
  permissionQueueHandlers,
  sessionHandlers,
} from '@/handlers/serverMessage';
import { resolveClientDescriptor } from '@/config/client-identity';
import { resolveHostUrl } from '@/lib/hostRoutes';
import { useChatRetryStore } from '@/stores/chatRetryStore';
import { foreignSessionsOf, useForeignSessionsStore } from '@/stores/foreignSessionsStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';

/**
 * Live connections to other machines, one per machine, kept while at least one
 * of its sessions is open on this board. The active machine's connection is
 * owned by `useConnectionLifecycle`; this pool never touches it.
 *
 * Events reuse the normal handlers with a derived context: content setters are
 * shared (keyed by session id), while list updates go to the foreign sessions
 * store and never replace the active machine's list.
 */

export type HostClientStatus = 'connecting' | 'connected' | 'offline' | 'unpaired';

interface HostClientState {
  clients: Record<string, ProkopaiClient>;
  urls: Record<string, string>;
  status: Record<string, HostClientStatus>;
}

export const useHostClientStore = create<HostClientState>(() => ({ clients: {}, urls: {}, status: {} }));

type ContextProvider = () => SessionHandlersContext | null;
let activeContext: ContextProvider = () => null;

/** The active machine's handler context; foreign contexts derive from it. Set by the session manager. */
export function setForeignHandlerContextProvider(provider: ContextProvider): void {
  activeContext = provider;
}

function foreignContext(serverId: string): SessionHandlersContext | null {
  const base = activeContext();
  if (!base) return null;
  return {
    ...base,
    serverId,
    setCurrentSession: () => {},
    currentSessionIdRef: { current: null },
    pendingSessionCreateRef: { current: null },
    sessionsRef: { current: foreignSessionsOf(serverId) },
    setSessions: (updater) => {
      const next = typeof updater === 'function' ? updater(foreignSessionsOf(serverId)) : updater;
      // Only sessions already open on this board are tracked; others are ignored.
      for (const session of next) useForeignSessionsStore.getState().update(session);
    },
  };
}

const tracked = (serverId: string, sessionId: unknown) =>
  typeof sessionId === 'string' && useForeignSessionsStore.getState().byId[sessionId]?.serverId === serverId;

function subscribe(client: ProkopaiClient, serverId: string): () => void {
  const handlers: Array<[string, (...args: unknown[]) => void]> = [];
  const add = (event: string, handler: (...args: unknown[]) => void) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypedEventEmitter event names
    client.on(event as any, handler as any);
    handlers.push([event, handler]);
  };
  const ctx = () => foreignContext(serverId);
  const withCtx = (run: (context: SessionHandlersContext) => void) => {
    const context = ctx();
    if (context) run(context);
  };

  add('session.resumed', (session, messages, usage, isRunning, control, transcript) => {
    const value = session as Session;
    if (!tracked(serverId, value.id)) return;
    useForeignSessionsStore.getState().update(value);
    if (!isRunning) useChatRetryStore.getState().clearRetry(value.id);
    withCtx((context) => sessionHandlers['session.resumed']({
      type: 'session.resumed',
      session: value,
      messages: messages as MessageWithParts[] | undefined,
      usage: usage as never,
      isRunning: isRunning as boolean | undefined,
      control: control as never,
      transcript: transcript as never,
    } as never, context));
  });
  for (const type of ['session.updated', 'session.renamed', 'session.reopened'] as const) {
    add(type, (session) => {
      if (!tracked(serverId, (session as Session).id)) return;
      withCtx((context) => sessionHandlers[type]({ type, session: session as Session } as never, context));
    });
  }
  add('session.interrupted', (sessionId, result) => {
    if (!tracked(serverId, sessionId)) return;
    useChatRetryStore.getState().clearRetry(sessionId as string);
    withCtx((context) => sessionHandlers['session.interrupted']({ type: 'session.interrupted', sessionId: sessionId as string, result: result as never }, context));
  });
  add('session.reverted', (sessionId, revertedTo, removed) => {
    if (!tracked(serverId, sessionId)) return;
    withCtx((context) => sessionHandlers['session.reverted']({ type: 'session.reverted', sessionId: sessionId as string, revertedTo: revertedTo as never, removed: removed as never }, context));
  });
  add('session.state', (sessionId, messages) => {
    if (!tracked(serverId, sessionId)) return;
    withCtx((context) => sessionHandlers['session.state']({ type: 'session.state', sessionId: sessionId as string, messages: messages as MessageWithParts[] }, context));
  });
  add('session.deleted', (sessionId) => {
    if (!tracked(serverId, sessionId)) return;
    useSessionBoardStore.getState().removeFromBoard(sessionId as string);
    useForeignSessionsStore.getState().remove(sessionId as string);
  });
  add('session.control.updated', (control, reason) => {
    withCtx((context) => controlHandlers['session.control.updated']({ type: 'session.control.updated', control: control as never, reason: reason as never }, context));
  });
  add('session.action_rejected', (sessionId, action, code, message, control) => {
    if (!tracked(serverId, sessionId)) return;
    withCtx((context) => controlHandlers['session.action_rejected']({ type: 'session.action_rejected', sessionId: sessionId as string, action: action as string, code: code as string, message: message as string, control: control as never }, context));
  });

  // Content events arrive only for sessions this connection resumed.
  add('message.created', (message) => withCtx((context) => messagePartHandlers['message.created']({ type: 'message.created', message: message as Message }, context)));
  add('message.updated', (message) => withCtx((context) => messagePartHandlers['message.updated']({ type: 'message.updated', message: message as Message }, context)));
  add('part.created', (sessionId, part) => withCtx((context) => messagePartHandlers['part.created']({ type: 'part.created', sessionId: sessionId as string, part: part as Part }, context)));
  add('part.updated', (sessionId, part) => withCtx((context) => messagePartHandlers['part.updated']({ type: 'part.updated', sessionId: sessionId as string, part: part as Part }, context)));
  add('part.append', (sessionId, partId, field, delta) => withCtx((context) => messagePartHandlers['part.append']({ type: 'part.append', sessionId: sessionId as string, partId: partId as string, field: field as 'text' | 'reasoning', delta: delta as string }, context)));
  add('chat.usage', (sessionId, usage, model) => withCtx((context) => messagePartHandlers['chat.usage']({ type: 'chat.usage', sessionId: sessionId as string, usage: usage as never, model: model as string }, context)));
  add('compaction.complete', (sessionId, tokensUsed) => withCtx((context) => messagePartHandlers['compaction.complete']({ type: 'compaction.complete', sessionId: sessionId as string, tokensUsed: tokensUsed as never }, context)));
  add('chat.retry', (message) => useChatRetryStore.getState().applyRetry(message as never));
  add('queue.list', (sessionId, messages) => withCtx((context) => permissionQueueHandlers['queue.list']({ type: 'queue.list', sessionId: sessionId as string, messages: messages as QueuedMessage[] }, context)));
  add('queue.added', (sessionId, message) => withCtx((context) => permissionQueueHandlers['queue.added']({ type: 'queue.added', sessionId: sessionId as string, message: message as QueuedMessage }, context)));
  add('queue.removed', (sessionId, queueId) => withCtx((context) => permissionQueueHandlers['queue.removed']({ type: 'queue.removed', sessionId: sessionId as string, queueId: queueId as string }, context)));
  add('queue.sending', (sessionId, queueId) => withCtx((context) => permissionQueueHandlers['queue.sending']({ type: 'queue.sending', sessionId: sessionId as string, queueId: queueId as string }, context)));
  add('ask.request', (sessionId, toolCallId, toolName, ask, requestId, authority) => withCtx((context) => askHandlers['ask.request']({ type: 'ask.request', sessionId: sessionId as string, toolCallId: toolCallId as string, toolName: toolName as string, ask: ask as never, requestId: requestId as string | undefined, authority: authority as never }, context)));
  add('ask.response_rejected', (sessionId, toolCallId, requestId, code, message) => withCtx((context) => askHandlers['ask.response_rejected']({ type: 'ask.response_rejected', sessionId: sessionId as string, toolCallId: toolCallId as string, requestId: requestId as string | undefined, code: code as string, message: message as string }, context)));
  add('ask.timeout', (sessionId, toolCallId, requestId) => withCtx((context) => askHandlers['ask.timeout']({ type: 'ask.timeout', sessionId: sessionId as string, toolCallId: toolCallId as string, requestId: requestId as string | undefined }, context)));
  add('ask.pending_sync', (sessionId, requests) => withCtx((context) => askHandlers['ask.pending_sync']({ type: 'ask.pending_sync', sessionId: sessionId as string, requests: requests as never }, context)));
  add('error', (code, message, sessionId) => {
    if (sessionId !== undefined && !tracked(serverId, sessionId)) return;
    withCtx((context) => messagePartHandlers['error']({ type: 'error', code: code as string, message: message as string, sessionId: sessionId as string | undefined }, context));
  });

  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypedEventEmitter event names
    for (const [event, handler] of handlers) client.off(event as any, handler as any);
  };
}

interface PoolEntry {
  refs: number;
  stop: () => void;
}

const entries = new Map<string, PoolEntry>();
const MAX_BACKOFF_MS = 30_000;

function setStatus(serverId: string, status: HostClientStatus): void {
  useHostClientStore.setState((state) => ({ status: { ...state.status, [serverId]: status } }));
}

/** Resumes every open foreign session of a machine on its (re)connected client. */
function resumeOpenSessions(serverId: string, client: ProkopaiClient): void {
  const open = new Set(useSessionBoardStore.getState().openSessionIds);
  for (const session of foreignSessionsOf(serverId)) {
    if (!open.has(session.id)) continue;
    useSessionStore.getState().beginSessionContentLoad(session.id);
    client.sessions.resume(session.id);
  }
}

function start(server: SavedServer): () => void {
  let stopped = false;
  let client: ProkopaiClient | null = null;
  let unsubscribe: (() => void) | null = null;
  // Ends the wait for the current connection (stop, or a failed connect).
  const pending: { wake: (() => void) | null } = { wake: null };

  const teardown = () => {
    unsubscribe?.();
    unsubscribe = null;
    void client?.dispose().catch(() => {});
    client = null;
    useHostClientStore.setState((state) => {
      const { [server.id]: _client, ...clients } = state.clients;
      return { clients };
    });
  };

  void (async () => {
    const descriptor = await resolveClientDescriptor();
    let failures = 0;
    while (!stopped) {
      setStatus(server.id, 'connecting');
      const url = await resolveHostUrl(server, undefined, { reprobe: failures > 0 });
      if (stopped) return;
      const next = new ProkopaiClient({ url, ...(server.token ? { token: server.token } : {}), autoSyncPermissions: false, clientDescriptor: descriptor });
      client = next;
      unsubscribe = subscribe(next, server.id);
      const closed = new Promise<{ code: number } | null>((resolve) => {
        next.on('disconnected', (payload) => resolve(payload as { code: number }));
        pending.wake = () => resolve(null);
      });
      next.on('connected', () => {
        failures = 0;
        setStatus(server.id, 'connected');
        resumeOpenSessions(server.id, next);
      });
      useHostClientStore.setState((state) => ({
        clients: { ...state.clients, [server.id]: next },
        urls: { ...state.urls, [server.id]: url },
      }));
      try {
        await next.connect();
      } catch (error: unknown) {
        if (error instanceof AuthError || (error as { status?: number })?.status === 401) {
          teardown();
          setStatus(server.id, 'unpaired');
          return;
        }
        pending.wake?.();
      }
      await closed;
      teardown();
      if (stopped) return;
      setStatus(server.id, 'offline');
      failures++;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** Math.min(failures, 5), MAX_BACKOFF_MS)));
    }
  })();

  return () => {
    stopped = true;
    pending.wake?.();
    teardown();
  };
}

/** Keeps a connection to `server` while held; pair every call with releaseHostClient. */
export function acquireHostClient(server: SavedServer): void {
  const entry = entries.get(server.id);
  if (entry) {
    entry.refs++;
    return;
  }
  entries.set(server.id, { refs: 1, stop: start(server) });
}

export function releaseHostClient(serverId: string): void {
  const entry = entries.get(serverId);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  entries.delete(serverId);
  entry.stop();
  useHostClientStore.setState((state) => {
    const { [serverId]: _status, ...status } = state.status;
    const { [serverId]: _url, ...urls } = state.urls;
    return { status, urls };
  });
}

/** The connection for a foreign session, or null for the active machine's sessions. */
export function foreignClientFor(sessionId: string | null | undefined): ProkopaiClient | null {
  if (!sessionId) return null;
  const serverId = useForeignSessionsStore.getState().byId[sessionId]?.serverId;
  return serverId ? useHostClientStore.getState().clients[serverId] ?? null : null;
}
