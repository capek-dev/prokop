import type { WorkerPoolManager } from '@pierre/diffs/worker';
import { PIERRE_THEME_PAIR } from '@/lib/pierreDiffsTheme';

/**
 * App-lifetime Pierre worker pool: Shiki tokenization for every read-only
 * code/diff surface runs in Web Workers instead of on the main thread.
 *
 * The pool is published only after it finishes initializing. Pierre captures
 * the pool when a surface mounts, and a surface mounted against a pool whose
 * main-side highlighter is not ready yet renders blank until it remounts.
 * Surfaces that mount before publication keep main-thread highlighting (the
 * preloaded shared highlighter), so nothing ever waits on the workers. If the
 * workers fail, the pool is never published and every surface stays on the
 * main-thread path.
 */

/** Highlighted results kept for remounts (scroll-back, collapse/expand). */
const AST_CACHE_SIZE = 240;

let pool: WorkerPoolManager | undefined;
let started = false;
const listeners = new Set<() => void>();

/** Half the cores, clamped to 2..4: enough parallelism, bounded memory. */
export function pierreWorkerPoolSize(hardwareConcurrency: number | undefined): number {
  const cores = Math.max(1, hardwareConcurrency || 4);
  return Math.max(2, Math.min(4, Math.floor(cores / 2)));
}

/** Loads the pool manager lazily so it stays out of the startup bundle. */
export async function startPierreWorkerPool(workerFactory: () => Worker): Promise<void> {
  if (started || typeof Worker === 'undefined') return;
  started = true;
  let candidate: WorkerPoolManager;
  try {
    const { WorkerPoolManager } = await import('@pierre/diffs/worker');
    candidate = new WorkerPoolManager(
      {
        workerFactory,
        poolSize: pierreWorkerPoolSize(navigator.hardwareConcurrency),
        totalASTLRUCacheSize: AST_CACHE_SIZE,
      },
      { theme: PIERRE_THEME_PAIR },
    );
  } catch (error) {
    console.warn('[pierreWorkerPool] Could not create workers; highlighting stays on the main thread.', error);
    return;
  }
  candidate.initialize().then(
    () => {
      if (!candidate.isInitialized() || !candidate.isWorkingPool()) {
        candidate.terminate();
        return;
      }
      pool = candidate;
      for (const listener of listeners) listener();
    },
    (error: unknown) => {
      console.warn('[pierreWorkerPool] Workers failed to start; highlighting stays on the main thread.', error);
      candidate.terminate();
    },
  );
}

export function subscribePierreWorkerPool(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPierreWorkerPool(): WorkerPoolManager | undefined {
  return pool;
}

/** Test-only: drop the published pool so each test starts cold. */
export function resetPierreWorkerPoolForTests(): void {
  pool?.terminate();
  pool = undefined;
  started = false;
  listeners.clear();
}

// Dev HMR re-evaluates this module; terminate the old workers with it.
import.meta.hot?.dispose(() => {
  pool?.terminate();
});
