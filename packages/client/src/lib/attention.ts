import { create } from 'zustand';
import {
  AuthError,
  followAttention,
  type AttentionAsk,
  type AttentionRunningSession,
  type AttentionSnapshot,
  type SavedServer,
} from '@prokopai/sdk';
import { resolveHostUrl } from '@/lib/hostRoutes';

/**
 * Attention from every saved machine: one Server-Sent Events stream per
 * machine pushes its pending approvals, questions, and running sessions. The
 * stream owner here is the only place that retries; views read the store.
 */

export type AttentionConnection = 'connecting' | 'live' | 'offline' | 'unpaired';

export interface HostAttention {
  connection: AttentionConnection;
  snapshot: AttentionSnapshot | null;
}

interface AttentionState {
  hosts: Record<string, HostAttention>;
  update: (serverId: string, patch: Partial<HostAttention>) => void;
  remove: (serverId: string) => void;
}

export const useAttentionStore = create<AttentionState>((set) => ({
  hosts: {},
  update: (serverId, patch) => set((state) => ({
    hosts: { ...state.hosts, [serverId]: { ...(state.hosts[serverId] ?? { connection: 'connecting', snapshot: null }), ...patch } },
  })),
  remove: (serverId) => set((state) => {
    const { [serverId]: _removed, ...rest } = state.hosts;
    return { hosts: rest };
  }),
}));

export interface AttentionChanges {
  /** Asks that were not in the previous snapshot (all of them on first contact). */
  newAsks: AttentionAsk[];
  /** Asks that were answered, timed out, or cancelled. */
  resolvedAskIds: string[];
  /** Sessions that stopped running since the previous snapshot. */
  finished: AttentionRunningSession[];
}

export function diffAttention(previous: AttentionSnapshot | null, next: AttentionSnapshot): AttentionChanges {
  const previousAskIds = new Set(previous?.asks.map((ask) => ask.id) ?? []);
  const nextAskIds = new Set(next.asks.map((ask) => ask.id));
  const stillRunning = new Set(next.running.map((session) => session.sessionId));
  return {
    newAsks: next.asks.filter((ask) => !previousAskIds.has(ask.id)),
    resolvedAskIds: [...previousAskIds].filter((id) => !nextAskIds.has(id)),
    finished: (previous?.running ?? []).filter((session) => !stillRunning.has(session.sessionId)),
  };
}

const MAX_BACKOFF_MS = 30_000;

/** Resolves after `ms`, or earlier when the network returns or the page comes back to the foreground. */
function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener('online', done);
      document.removeEventListener('visibilitychange', onVisible);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') done(); };
    const timer = setTimeout(done, ms);
    window.addEventListener('online', done);
    document.addEventListener('visibilitychange', onVisible);
    signal.addEventListener('abort', done);
  });
}

/**
 * Keeps one machine's attention stream open until stopped. Transient failures
 * retry with capped backoff; an unpaired machine waits until its saved token
 * changes (which restarts the stream from the caller).
 */
export function startAttentionStream(
  server: SavedServer,
  onSnapshot: (previous: AttentionSnapshot | null, next: AttentionSnapshot) => void,
): () => void {
  const controller = new AbortController();
  const { update } = useAttentionStore.getState();
  let previous: AttentionSnapshot | null = useAttentionStore.getState().hosts[server.id]?.snapshot ?? null;

  void (async () => {
    let failures = 0;
    while (!controller.signal.aborted) {
      update(server.id, { connection: 'connecting' });
      try {
        // After a failure the known address may be the one that stopped answering.
        const url = await resolveHostUrl(server, controller.signal, { reprobe: failures > 0 });
        await followAttention(url, server.token, (snapshot) => {
          failures = 0;
          update(server.id, { connection: 'live', snapshot });
          onSnapshot(previous, snapshot);
          previous = snapshot;
        }, controller.signal);
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        if (error instanceof AuthError) {
          update(server.id, { connection: 'unpaired' });
          return;
        }
        failures++;
      }
      if (controller.signal.aborted) return;
      // Keep the last snapshot visible but mark it stale.
      update(server.id, { connection: 'offline' });
      await waitForRetry(Math.min(1000 * 2 ** Math.min(failures, 5), MAX_BACKOFF_MS), controller.signal);
    }
  })();

  return () => controller.abort();
}
