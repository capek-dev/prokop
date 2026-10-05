/**
 * Server-owned feed of one computed snapshot per workspace root, shared by
 * every subscriber and by HTTP reads, published only when it changed. The
 * Git status feed and the file tree feed are built on it.
 *
 * Throttling: a trigger opens a short collect window; while triggers keep
 * arriving, computes run at most once per `minIntervalMs`; a trigger that
 * lands during a compute marks the root dirty, so the last change always
 * gets a final run.
 */

export const ROOT_FEED_COLLECT_MS = 250;
export const ROOT_FEED_MIN_INTERVAL_MS = 2_000;

export type Revisioned<Snapshot> = Snapshot & { revision: number };

export interface RootFeedPublication<Snapshot> {
  workspaceId: string;
  root: string;
  current: Revisioned<Snapshot>;
  /** What the recipient already holds; null when it needs the full snapshot. */
  previous: Revisioned<Snapshot> | null;
}

export interface RootFeedDependencies<Subscriber, Snapshot, Message> {
  /** Resolved absolute root for a workspace and optional root query. Throws for unknown workspaces. */
  resolveRoot(workspaceId: string, rootQuery?: string): string;
  compute(workspaceId: string, root: string): Promise<Snapshot>;
  /** Content equality. An unchanged run keeps its revision and publishes only to new subscribers. */
  same(previous: Snapshot, next: Snapshot): boolean;
  /** Built at most once per run for full snapshots and once for changes. */
  message(publication: RootFeedPublication<Snapshot>): Message;
  deliver(subscriber: Subscriber, message: Message): void;
  collectMs?: number;
  minIntervalMs?: number;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface RootFeed<Subscriber, Snapshot> {
  /** Registers interest and sends this subscriber a fresh snapshot. */
  subscribe(subscriber: Subscriber, workspaceId: string, rootQuery?: string): void;
  unsubscribe(subscriber: Subscriber, workspaceId: string, rootQuery?: string): void;
  /** Drops every subscription of a closed connection. */
  disconnect(subscriber: Subscriber): void;
  /** Throttled refresh of every subscribed root in the workspace. */
  filesChanged(workspaceId: string): void;
  /** Immediate refresh of a subscribed root (app actions, client focus). */
  refresh(workspaceId: string, rootQuery?: string): void;
  /** Same as `refresh` for an already resolved root. */
  refreshRoot(workspaceId: string, root: string): void;
  /**
   * Current snapshot through the same serialized runner as publications.
   * `fresh` skips the cache of a watched root (manual refresh), so changes
   * no trigger reported (terminals, external editors) are picked up.
   */
  read(workspaceId: string, rootQuery?: string, options?: RootFeedReadOptions): Promise<Revisioned<Snapshot>>;
}

export interface RootFeedReadOptions {
  fresh?: boolean;
}

interface Entry<Subscriber, Snapshot> {
  workspaceId: string;
  root: string;
  subscribers: Set<Subscriber>;
  /** Subscribers owed a full snapshot from the next completed run, changed or not. */
  owed: Set<Subscriber>;
  readers: Array<{ resolve(snapshot: Revisioned<Snapshot>): void; reject(error: unknown): void }>;
  /** Last computed snapshot, compared with the next one. */
  computed: Snapshot | null;
  current: Revisioned<Snapshot> | null;
  timer: unknown;
  running: boolean;
  dirty: boolean;
  lastRunAt: number;
}

export function createRootFeed<Subscriber, Snapshot extends object, Message>(
  deps: RootFeedDependencies<Subscriber, Snapshot, Message>,
): RootFeed<Subscriber, Snapshot> {
  const collectMs = deps.collectMs ?? ROOT_FEED_COLLECT_MS;
  const minIntervalMs = deps.minIntervalMs ?? ROOT_FEED_MIN_INTERVAL_MS;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const entries = new Map<string, Entry<Subscriber, Snapshot>>();
  // Wall-clock seeded so a restarted server never reuses revisions a client already holds.
  let lastRevision = 0;
  const nextRevision = (): number => (lastRevision = Math.max(now(), lastRevision + 1));

  const keyOf = (workspaceId: string, root: string): string => `${workspaceId}\0${root}`;

  function entryFor(workspaceId: string, root: string): Entry<Subscriber, Snapshot> {
    const key = keyOf(workspaceId, root);
    let entry = entries.get(key);
    if (!entry) {
      entry = { workspaceId, root, subscribers: new Set(), owed: new Set(), readers: [], computed: null,
        current: null, timer: null, running: false, dirty: false, lastRunAt: Number.NEGATIVE_INFINITY };
      entries.set(key, entry);
    }
    return entry;
  }

  function release(entry: Entry<Subscriber, Snapshot>): void {
    if (entry.subscribers.size || entry.readers.length || entry.running) return;
    if (entry.timer !== null) {
      clearTimer(entry.timer);
      entry.timer = null;
    }
    entries.delete(keyOf(entry.workspaceId, entry.root));
  }

  function schedule(entry: Entry<Subscriber, Snapshot>, immediate: boolean): void {
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

  function publish(
    entry: Entry<Subscriber, Snapshot>,
    current: Revisioned<Snapshot>,
    previous: Revisioned<Snapshot> | null,
    owed: Set<Subscriber>,
  ): void {
    const changed = current !== previous;
    let full: Message | undefined;
    let change: Message | undefined;
    const base = { workspaceId: entry.workspaceId, root: entry.root, current };
    for (const subscriber of changed ? entry.subscribers : owed) {
      if (!entry.subscribers.has(subscriber)) continue;
      // Subscribers that joined during this compute hold nothing yet either.
      const needsFull = !previous || owed.has(subscriber) || entry.owed.has(subscriber);
      try {
        deps.deliver(subscriber, needsFull
          ? (full ??= deps.message({ ...base, previous: null }))
          : (change ??= deps.message({ ...base, previous })));
      } catch {
        // A closing socket must not stop delivery to the others.
      }
    }
  }

  async function run(entry: Entry<Subscriber, Snapshot>): Promise<void> {
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
      const previous = entry.current;
      const current = previous && entry.computed && deps.same(entry.computed, snapshot)
        ? previous : { ...snapshot, revision: nextRevision() };
      entry.computed = snapshot;
      entry.current = current;
      for (const reader of readers) reader.resolve(current);
      publish(entry, current, previous, owed);
    } finally {
      entry.running = false;
      if (entry.dirty || entry.readers.length || entry.owed.size) schedule(entry, entry.readers.length > 0 || entry.owed.size > 0);
      release(entry);
    }
  }

  function resolved(workspaceId: string, rootQuery?: string): Entry<Subscriber, Snapshot> | null {
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

    read(workspaceId, rootQuery, options) {
      const entry = entryFor(workspaceId, deps.resolveRoot(workspaceId, rootQuery));
      // Subscribed roots are kept current by triggers; serve the cache when nothing is pending.
      if (!options?.fresh && entry.current && entry.subscribers.size && !entry.running && entry.timer === null && !entry.dirty) {
        return Promise.resolve(entry.current);
      }
      return new Promise((resolve, reject) => {
        entry.readers.push({ resolve, reject });
        schedule(entry, true);
      });
    },
  };
}
