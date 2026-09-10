import { describe, expect, test } from 'bun:test';
import { createLearningCoordinator, type LearningCoordinatorDependencies } from '@/application/learning/coordinator';

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

function fixture(overrides: Partial<LearningCoordinatorDependencies> = {}) {
  const timers = new Map<ReturnType<typeof setTimeout>, { callback: () => void; delay: number }>();
  const errors: unknown[] = [];
  let nextId = 0;
  let reconciles = 0;
  let runs = 0;
  const coordinator = createLearningCoordinator({
    now: () => 1000,
    reconcile: async () => { reconciles++; return null; },
    runDue: async () => { runs++; return false; },
    onError: error => { errors.push(error); },
    setTimer: (callback, delay) => {
      const id = ++nextId as unknown as ReturnType<typeof setTimeout>;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: id => { timers.delete(id); },
    ...overrides,
  });
  return { coordinator, timers, errors, reconciles: () => reconciles, runs: () => runs };
}

describe('learning coordinator', () => {
  test('startup catches up once, empty work creates no recurring timer', async () => {
    const f = fixture();
    f.coordinator.start();
    f.coordinator.start();
    await flush();
    expect(f.reconciles()).toBe(1);
    expect(f.runs()).toBe(0);
    expect(f.timers.size).toBe(0);
    f.coordinator.notifyActivity();
    await flush();
    expect(f.reconciles()).toBe(2);
    await f.coordinator.stop();
  });

  test('schedules one deadline and foreground events replace it', async () => {
    const f = fixture({ reconcile: async () => 31_000 });
    f.coordinator.start();
    await flush();
    expect([...f.timers.values()].map(timer => timer.delay)).toEqual([30_000]);
    f.coordinator.notifyActivity();
    await flush();
    expect(f.timers.size).toBe(1);
    await f.coordinator.stop();
    expect(f.timers.size).toBe(0);
  });

  test('coalesces events during execution and awaits cancellation before stopping', async () => {
    let release!: () => void;
    let signal: AbortSignal | undefined;
    let calls = 0;
    const f = fixture({
      reconcile: async () => 1000,
      runDue: async abort => {
        calls++;
        signal = abort;
        await new Promise<void>(resolve => { release = resolve; });
        return false;
      },
    });
    f.coordinator.start();
    await flush();
    f.coordinator.notifyActivity();
    f.coordinator.notifyActivity();
    expect(calls).toBe(1);
    const stopping = f.coordinator.stop();
    expect(signal?.aborted).toBe(true);
    expect(() => f.coordinator.start()).toThrow('stopping');
    release();
    await stopping;
    expect(f.timers.size).toBe(0);
    expect(calls).toBe(1);
  });

  test('bounds immediate backlog and yields through a timer', async () => {
    let calls = 0;
    const f = fixture({ reconcile: async () => 1000, runDue: async () => { calls++; return true; } });
    f.coordinator.start();
    await flush();
    expect(calls).toBe(5);
    expect([...f.timers.values()].map(timer => timer.delay)).toEqual([1]);
    await f.coordinator.stop();
  });

  test('failure schedules bounded retry rather than a hot loop', async () => {
    const f = fixture({ reconcile: async () => { throw new Error('offline'); } });
    f.coordinator.start();
    await flush();
    expect(f.errors).toHaveLength(1);
    expect([...f.timers.values()].map(timer => timer.delay)).toEqual([60_000]);
    await f.coordinator.stop();
  });

  test('rejects malformed deadlines without executing', async () => {
    const f = fixture({ reconcile: async () => NaN });
    f.coordinator.start();
    await flush();
    expect(f.errors).toHaveLength(1);
    expect(f.runs()).toBe(0);
    await f.coordinator.stop();
  });
});
