import type { HarnessUsageLimits, HarnessUsageWindow, HarnessUsageWindowKind } from '@prokopai/sdk';

const KIND_ORDER: Record<HarnessUsageWindowKind, number> = { session: 0, weekly: 1, monthly: 2, other: 3 };

export function clampUsagePercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function usageLimits(
  harness: HarnessUsageLimits['harness'],
  plan: string | null,
  windows: HarnessUsageWindow[],
): HarnessUsageLimits {
  return {
    harness,
    checkedAt: new Date().toISOString(),
    plan,
    // Stable sort: within a kind, the harness's own order wins (plain weekly before per-model weeklies).
    windows: [...windows].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]),
  };
}

export function unavailableUsageLimits(
  harness: HarnessUsageLimits['harness'],
  reason: 'unsupported' | 'probeFailed',
  message: string,
  plan: string | null = null,
): HarnessUsageLimits {
  return { harness, checkedAt: new Date().toISOString(), plan, windows: [], unavailable: { reason, message } };
}

/**
 * Share one in-flight read and reuse its result briefly, so reopening the
 * settings panel does not spawn a CLI per render. Failures are not cached.
 */
export function createUsageLimitsCache(
  read: () => Promise<HarnessUsageLimits>,
  ttlMs = 30_000,
): () => Promise<HarnessUsageLimits> {
  let cache: { at: number; promise: Promise<HarnessUsageLimits> } | null = null;
  return () => {
    if (!cache || Date.now() - cache.at > ttlMs) {
      const promise = read().then(result => {
        if (result.unavailable?.reason === 'probeFailed' && cache?.promise === promise) cache = null;
        return result;
      }, (error: unknown) => {
        if (cache?.promise === promise) cache = null;
        throw error;
      });
      cache = { at: Date.now(), promise };
    }
    return cache.promise;
  };
}
