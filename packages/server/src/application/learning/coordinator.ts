export interface LearningCoordinatorDependencies {
  /** Discover eligible completed evidence and return the earliest next review deadline. */
  reconcile(signal: AbortSignal): Promise<number | null>;
  /** Execute at most one bounded batch; return true if another destination can run now. */
  runDue(signal: AbortSignal): Promise<boolean>;
  now(): number;
  onError(error: unknown): void;
  setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}

export interface LearningCoordinator {
  start(): void;
  notifyActivity(): void;
  stop(): Promise<void>;
}

/** Event-driven single-flight coordinator. One deadline timer, no periodic polling. */
export function createLearningCoordinator(deps: LearningCoordinatorDependencies): LearningCoordinator {
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active: Promise<void> | null = null;
  let dirty = false;
  let stopping: Promise<void> | null = null;

  function clearTimer(): void {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }

  function schedule(at: number, signal: AbortSignal): void {
    clearTimer();
    if (signal.aborted) return;
    timer = deps.setTimer(wake, Math.max(1, Math.min(2_147_483_647, at - deps.now())));
  }

  async function drain(signal: AbortSignal): Promise<void> {
    // Bound each wake so a busy backlog yields to foreground requests.
    let batches = 0;
    do {
      dirty = false;
      const nextAt = await deps.reconcile(signal);
      if (signal.aborted) return;
      if (nextAt !== null && (!Number.isFinite(nextAt) || nextAt < 0)) throw new Error('Invalid learning deadline');
      if (nextAt !== null && nextAt <= deps.now()) {
        const more = await deps.runDue(signal);
        if (signal.aborted) return;
        batches++;
        if (more || dirty) {
          if (batches >= 5) {
            dirty = false;
            schedule(deps.now() + 1, signal);
            return;
          }
          dirty = true;
          continue;
        }
        // A completed run changes its cooldown. Reconcile instead of spinning on a stale deadline.
        const updated = await deps.reconcile(signal);
        if (updated !== null && (!Number.isFinite(updated) || updated < 0)) throw new Error('Invalid learning deadline');
        if (updated !== null) schedule(Math.max(deps.now() + 1000, updated), signal);
      } else if (nextAt !== null) {
        schedule(nextAt, signal);
      }
    } while (dirty && !signal.aborted);
  }

  function wake(): void {
    if (!controller || controller.signal.aborted) return;
    dirty = true;
    clearTimer();
    if (active) return;
    const signal = controller.signal;
    active = drain(signal).catch((error: unknown) => {
      if (!signal.aborted) {
        dirty = false;
        deps.onError(error);
        schedule(deps.now() + 60_000, signal);
      }
    }).finally(() => {
      active = null;
      if (dirty && !signal.aborted) wake();
    });
  }

  return {
    start() {
      if (stopping) throw new Error('Learning coordinator is stopping');
      if (controller) return;
      controller = new AbortController();
      wake();
    },
    notifyActivity: wake,
    stop() {
      if (stopping) return stopping;
      controller?.abort();
      clearTimer();
      dirty = false;
      stopping = (async () => {
        await active;
        controller = null;
        stopping = null;
      })();
      return stopping;
    },
  };
}
