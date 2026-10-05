/**
 * Server-owned Git status feed. One serialized computation per workspace
 * root, shared by every subscriber and by HTTP reads, pushed only when the
 * status changed. Replaces per-client refetching after every tool call.
 *
 * Throttling: a trigger opens a short collect window; while triggers keep
 * arriving, computes run at most once per `minIntervalMs`; a trigger that
 * lands during a compute marks the root dirty, so the last change always
 * gets a final run.
 */

import type { GitStatusMessage, GitStatusResponse } from '@prokopai/sdk';

export const GIT_STATUS_COLLECT_MS = 250;
export const GIT_STATUS_MIN_INTERVAL_MS = 2_000;

type Snapshot = Omit<GitStatusResponse, 'revision'>;

export interface GitStatusFeedDependencies<Subscriber> {
  /** Resolved absolute root for a workspace and optional root query. Throws for unknown workspaces. */
  resolveRoot(workspaceId: string, rootQuery?: string): string;
  compute(workspaceId: string, root: string): Promise<Snapshot>;
  deliver(subscriber: Subscriber, message: GitStatusMessage): void;
  collectMs?: number;
  minIntervalMs?: number;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface GitStatusFeed<Subscriber> {
  /** Registers interest and sends this subscriber a fresh snapshot. */
  subscribe(subscriber: Subscriber, workspaceId: string, rootQuery?: string): void;
  unsubscribe(subscriber: Subscriber, workspaceId: string, rootQuery?: string): void;
  /** Drops every subscription of a closed connection. */
  disconnect(subscriber: Subscriber): void;
  /** Throttled refresh of every subscribed root in the workspace. */
  filesChanged(workspaceId: string): void;
  /** Immediate refresh of a subscribed root (Git actions, client focus). */
  refresh(workspaceId: string, rootQuery?: string): void;
  /** Same as `refresh` for an already resolved root. */
  refreshRoot(workspaceId: string, root: string): void;
  /** Current status through the same serialized runner as pushes. */
  read(workspaceId: string, rootQuery?: string): Promise<GitStatusResponse>;
}

interface Entry<Subscriber> {
  workspaceId: string;
  root: string;
  subscribers: Set<Subscriber>;
  /** Subscribers owed a snapshot from the next completed run, changed or not. */
  owed: Set<Subscriber>;
  readers: Array<{ resolve(status: GitStatusResponse): void; reject(error: unknown): void }>;
  status: GitStatusResponse | null;
  fingerprint: string | null;
  timer: unknown;
  running: boolean;
  dirty: boolean;
  lastRunAt: number;
}

export function createGitStatusFeed<Subscriber>(
  deps: GitStatusFeedDependencies<Subscriber>,
): GitStatusFeed<Subscriber> {
  const collectMs = deps.collectMs ?? GIT_STATUS_COLLECT_MS;
  const minIntervalMs = deps.minIntervalMs ?? GIT_STATUS_MIN_INTERVAL_MS;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const entries = new Map<string, Entry<Subscriber>>();
  // Wall-clock seeded so a restarted server never reuses revisions a client already holds.
  let lastRevision = 0;
  const nextRevision = (): number => (lastRevision = Math.max(now(), lastRevision + 1));

  const keyOf = (workspaceId: string, root: string): string => `${workspaceId}\0${root}`;

  function entryFor(workspaceId: string, root: string): Entry<Subscriber> {
    const key = keyOf(workspaceId, root);
    let entry = entries.get(key);
    if (!entry) {
      entry = { workspaceId, root, subscribers: new Set(), owed: new Set(), readers: [], status: null,
        fingerprint: null, timer: null, running: false, dirty: false, lastRunAt: Number.NEGATIVE_INFINITY };
      entries.set(key, entry);
    }
    return entry;
  }

  function release(entry: Entry<Subscriber>): void {
    if (entry.subscribers.size || entry.readers.length || entry.running) return;
    if (entry.timer !== null) {
      clearTimer(entry.timer);
      entry.timer = null;
    }
    entries.delete(keyOf(entry.workspaceId, entry.root));
  }

  function schedule(entry: Entry<Subscriber>, immediate: boolean): void {
    if (entry.running) {
      entry.dirty = true;
      return;
    }
    if (entry.timer !== null) {
      if (!immediate) return;
      clearTimer(entry.timer);
    }
    const delay = immediate ? 0 : Math.max(collectMs, entry.lastRunAt + minIntervalMs - now());
    entry.timer = setTimer(() => void run(entry), delay);
  }

  async function run(entry: Entry<Subscriber>): Promise<void> {
    entry.timer = null;
    entry.running = true;
    entry.dirty = false;
    entry.lastRunAt = now();
    const owed = entry.owed;
    entry.owed = new Set();
    const readers = entry.readers;
    entry.readers = [];
    try {
      let snapshot: Snapshot;
      try {
        snapshot = await deps.compute(entry.workspaceId, entry.root);
      } catch (error) {
        for (const reader of readers) reader.reject(error);
        return;
      }
      const fingerprint = JSON.stringify(snapshot);
      const previous = entry.status;
      const status = previous && fingerprint === entry.fingerprint
        ? previous : { ...snapshot, revision: nextRevision() };
      const changed = status !== previous;
      entry.fingerprint = fingerprint;
      entry.status = status;
      for (const reader of readers) reader.resolve(status);
      const recipients = changed ? entry.subscribers : owed;
      for (const subscriber of recipients) {
        if (!entry.subscribers.has(subscriber)) continue;
        try {
          deps.deliver(subscriber, { type: 'git.status', workspaceId: entry.workspaceId, root: entry.root, status });
        } catch {
          // A closing socket must not stop delivery to the others.
        }
      }
    } finally {
      entry.running = false;
      if (entry.dirty || entry.readers.length || entry.owed.size) schedule(entry, entry.readers.length > 0 || entry.owed.size > 0);
      release(entry);
    }
  }

  function resolved(workspaceId: string, rootQuery?: string): Entry<Subscriber> | null {
    try {
      return entryFor(workspaceId, deps.resolveRoot(workspaceId, rootQuery));
    } catch {
      return null;
    }
  }

  return {
    subscribe(subscriber, workspaceId, rootQuery) {
      const entry = resolved(workspaceId, rootQuery);
      if (!entry) return;
      entry.subscribers.add(subscriber);
      entry.owed.add(subscriber);
      schedule(entry, true);
    },

    unsubscribe(subscriber, workspaceId, rootQuery) {
      const entry = resolved(workspaceId, rootQuery);
      if (!entry) return;
      entry.subscribers.delete(subscriber);
      entry.owed.delete(subscriber);
      release(entry);
    },

    disconnect(subscriber) {
      for (const entry of [...entries.values()]) {
        entry.subscribers.delete(subscriber);
        entry.owed.delete(subscriber);
        release(entry);
      }
    },

    filesChanged(workspaceId) {
      for (const entry of entries.values()) {
        if (entry.workspaceId === workspaceId && entry.subscribers.size) schedule(entry, false);
      }
    },

    refresh(workspaceId, rootQuery) {
      const entry = resolved(workspaceId, rootQuery);
      if (!entry) return;
      if (entry.subscribers.size) schedule(entry, true);
      else release(entry);
    },

    refreshRoot(workspaceId, root) {
      const entry = entries.get(keyOf(workspaceId, root));
      if (entry?.subscribers.size) schedule(entry, true);
    },

    read(workspaceId, rootQuery) {
      const entry = entryFor(workspaceId, deps.resolveRoot(workspaceId, rootQuery));
      // Subscribed roots are kept current by triggers; serve the cache when nothing is pending.
      if (entry.status && entry.subscribers.size && !entry.running && entry.timer === null && !entry.dirty) {
        return Promise.resolve(entry.status);
      }
      return new Promise((resolve, reject) => {
        entry.readers.push({ resolve, reject });
        schedule(entry, true);
      });
    },
  };
}
