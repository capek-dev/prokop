import type { ProkopaiClient } from '@prokopai/sdk';

/**
 * Ref-counted subscriptions to the server's per-root feeds (Git status, file
 * tree). Several views watch the same root; the server needs one
 * subscription per connection and root. Subscriptions are re-sent after a
 * reconnect, and window focus asks the server to recompute (it pushes only
 * when the result changed), which covers edits made outside Prokop.
 */

const FOCUS_REFRESH_DEBOUNCE_MS = 300;

type FeedCall = (client: ProkopaiClient, workspaceId: string, root: string | undefined) => void;

interface RootFeedChannel {
  subscribe: FeedCall;
  unsubscribe: FeedCall;
  refresh: FeedCall;
}

/** Watches a workspace root until the returned release is called. */
export type RetainRootFeed = (client: ProkopaiClient, workspaceId: string, root: string | undefined) => () => void;

interface Watched {
  workspaceId: string;
  root: string | undefined;
  count: number;
}

interface ClientState {
  watched: Map<string, Watched>;
  dispose(): void;
}

function attempt(send: () => void): void {
  try {
    send();
  } catch {
    // Not connected: the `connected` handler re-sends every subscription.
  }
}

function createRootFeedSubscriptions(channel: RootFeedChannel): RetainRootFeed {
  const clients = new WeakMap<ProkopaiClient, ClientState>();

  function stateFor(client: ProkopaiClient): ClientState {
    const existing = clients.get(client);
    if (existing) return existing;

    const watched = new Map<string, Watched>();
    const resubscribe = (): void => {
      for (const entry of watched.values()) attempt(() => channel.subscribe(client, entry.workspaceId, entry.root));
    };
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshAll = (): void => {
      if (focusTimer !== null) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        focusTimer = null;
        if (!client.connected) return;
        for (const entry of watched.values()) attempt(() => channel.refresh(client, entry.workspaceId, entry.root));
      }, FOCUS_REFRESH_DEBOUNCE_MS);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') refreshAll();
    };

    client.on('connected', resubscribe);
    window.addEventListener('focus', refreshAll);
    document.addEventListener('visibilitychange', onVisibility);

    const state: ClientState = {
      watched,
      dispose() {
        client.off('connected', resubscribe);
        window.removeEventListener('focus', refreshAll);
        document.removeEventListener('visibilitychange', onVisibility);
        if (focusTimer !== null) clearTimeout(focusTimer);
        clients.delete(client);
      },
    };
    clients.set(client, state);
    return state;
  }

  return (client, workspaceId, root) => {
    const state = stateFor(client);
    const key = `${workspaceId}\0${root ?? ''}`;
    const existing = state.watched.get(key);
    if (existing) {
      existing.count++;
    } else {
      state.watched.set(key, { workspaceId, root, count: 1 });
      if (client.connected) attempt(() => channel.subscribe(client, workspaceId, root));
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const entry = state.watched.get(key);
      if (!entry || --entry.count > 0) return;
      state.watched.delete(key);
      if (client.connected) attempt(() => channel.unsubscribe(client, workspaceId, root));
      if (state.watched.size === 0) state.dispose();
    };
  };
}

/** Watches a workspace root's Git status (`git.status` pushes). */
export const retainGitStatus = createRootFeedSubscriptions({
  subscribe: (client, workspaceId, root) => client.git.subscribeStatus(workspaceId, root),
  unsubscribe: (client, workspaceId, root) => client.git.unsubscribeStatus(workspaceId, root),
  refresh: (client, workspaceId, root) => client.git.refreshStatus(workspaceId, root),
});

/** Watches a workspace root's file tree (`files.tree` pushes). */
export const retainFileTree = createRootFeedSubscriptions({
  subscribe: (client, workspaceId, root) => client.files.subscribeTree(workspaceId, root),
  unsubscribe: (client, workspaceId, root) => client.files.unsubscribeTree(workspaceId, root),
  refresh: (client, workspaceId, root) => client.files.refreshTree(workspaceId, root),
});
