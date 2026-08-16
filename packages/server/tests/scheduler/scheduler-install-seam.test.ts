import { afterEach, describe, expect, test } from 'bun:test';
import { installSchedulerRuntime, startScheduler, stopScheduler } from '@/scheduler';
import type { SchedulingTicker } from '@/application/scheduling/ticker';

function makeTicker(overrides: Partial<SchedulingTicker> = {}): SchedulingTicker {
  return {
    start: () => {},
    stop: () => {},
    tick: async () => {},
    ...overrides,
  };
}

describe('scheduler install seam', () => {
  // Bun runs tests in definition order, and each test file gets its own
  // module registry, so the seam starts uninstalled here.
  test('startScheduler throws and stopScheduler is a no-op before installation', () => {
    expect(() => startScheduler()).toThrow(
      'Scheduler runtime is not installed. Call installSchedulerRuntime() during bootstrap.',
    );
    expect(() => stopScheduler()).not.toThrow();
  });

  test('startScheduler delegates to the installed ticker', () => {
    const calls: string[] = [];
    installSchedulerRuntime(makeTicker({ start: () => calls.push('start') }));
    startScheduler();
    expect(calls).toEqual(['start']);
  });

  test('stopScheduler delegates to the installed ticker', () => {
    const calls: string[] = [];
    installSchedulerRuntime(makeTicker({ stop: () => calls.push('stop') }));
    stopScheduler();
    expect(calls).toEqual(['stop']);
  });

  test('installing a new runtime replaces the previous one', () => {
    const calls: string[] = [];
    installSchedulerRuntime(makeTicker({ start: () => calls.push('first') }));
    installSchedulerRuntime(makeTicker({ start: () => calls.push('second') }));
    startScheduler();
    expect(calls).toEqual(['second']);
  });

  afterEach(() => {
    installSchedulerRuntime(makeTicker());
  });
});
