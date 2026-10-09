import type { AttentionAsk, AttentionRunningSession, AttentionSourcePort } from '@/application/ports/attention';

/** What needs the user on this server: open approvals and questions, and running sessions. */
export interface AttentionSnapshot {
  /** Increases whenever the content changes. */
  revision: number;
  asks: AttentionAsk[];
  running: AttentionRunningSession[];
}

export interface AttentionFeed {
  snapshot(): AttentionSnapshot;
  /** Called with each changed snapshot; returns an unsubscribe. */
  subscribe(listener: (snapshot: AttentionSnapshot) => void): () => void;
  dispose(): void;
}

export interface AttentionFeedOptions {
  source: AttentionSourcePort;
  /** Coalesces bursts of writes (a run updates its session many times). */
  debounceMs?: number;
}

/**
 * One attention snapshot per server, pushed to subscribers only when its
 * content changes. Every connected client (including background connections
 * from other machines) reads the same snapshot. The feed follows database
 * writes only while someone is subscribed.
 */
export function createAttentionFeed(options: AttentionFeedOptions): AttentionFeed {
  const { source } = options;
  const debounceMs = options.debounceMs ?? 150;
  const listeners = new Set<(snapshot: AttentionSnapshot) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let detachSource: (() => void) | null = null;
  let current: AttentionSnapshot | null = null;
  let fingerprint = '';

  /** Recomputes; returns true when the content changed. */
  const recompute = (): boolean => {
    const asks = source.pendingAsks();
    const running = source.runningSessions();
    const next = JSON.stringify([asks, running]);
    if (current !== null && next === fingerprint) return false;
    fingerprint = next;
    current = { revision: (current?.revision ?? 0) + 1, asks, running };
    return true;
  };

  const flush = () => {
    timer = null;
    try {
      if (recompute()) for (const listener of listeners) listener(current!);
    } catch (error: unknown) {
      console.error('[attention] refresh failed:', error);
    }
  };

  const stopFollowing = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    detachSource?.();
    detachSource = null;
  };

  return {
    snapshot() {
      // Without subscribers nothing follows writes, so read fresh.
      if (current === null || detachSource === null) recompute();
      return current!;
    },

    subscribe(listener) {
      listeners.add(listener);
      if (detachSource === null) {
        detachSource = source.subscribe(() => {
          if (timer !== null) return;
          timer = setTimeout(flush, debounceMs);
          timer.unref?.();
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopFollowing();
      };
    },

    dispose() {
      stopFollowing();
      listeners.clear();
    },
  };
}
