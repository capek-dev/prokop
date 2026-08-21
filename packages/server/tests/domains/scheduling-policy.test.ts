import { describe, expect, test } from 'bun:test';
import type { ScheduledJob, Session } from '@prokopai/sdk';
import { computeNextRun, scheduleDisplay } from '@/domains/scheduling/schedule';
import {
  decideNextRunAfterAdvance,
  decideNextRunOnUpdate,
} from '@/domains/scheduling/job-lifecycle';
import {
  canNotifyForSession,
  scheduledSessionOrigin,
} from '@/domains/scheduling/notifications';

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'job-1',
    workspaceId: 'ws-1',
    name: 'Job',
    prompt: 'Run',
    scheduleKind: 'interval',
    scheduleConfig: { type: 'interval', intervalMinutes: 60 },
    scheduleDisplay: 'Every 60m',
    state: 'active',
    repeatLimit: null,
    runCount: 0,
    nextRunAt: null,
    lastRunAt: null,
    lastRunSessionId: null,
    lastError: null,
    reuseSession: false,
    includeHistory: false,
    preconfigId: null,
    originSessionId: null,
    autoApproveSeverity: null,
    notificationsEnabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    workspaceId: 'ws-1',
    preconfigId: null,
    title: 'Session',
    status: 'active',
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Session;
}

describe('scheduling domain: schedule computation', () => {
  test('computeNextRun for intervals adds intervalMinutes to the base time', () => {
    const base = 1_000_000;
    expect(computeNextRun({ type: 'interval', intervalMinutes: 120 }, base)).toBe(
      base + 120 * 60_000,
    );
  });

  test('computeNextRun for once returns the runAt timestamp or null when invalid', () => {
    const ts = new Date('2030-01-01T00:00:00Z').getTime();
    expect(computeNextRun({ type: 'once', runAt: '2030-01-01T00:00:00Z' }, 0)).toBe(ts);
    expect(computeNextRun({ type: 'once', runAt: 'not-a-date' }, 0)).toBeNull();
  });

  test('computeNextRun for daily rolls to the next day when the time has passed', () => {
    // 2026-01-01 is a Thursday at 10:00 local time in this deterministic base.
    const base = new Date(2026, 0, 1, 10, 0, 0).getTime();
    const earlier = computeNextRun({ type: 'daily', time: '09:00' }, base)!;
    const later = computeNextRun({ type: 'daily', time: '11:00' }, base)!;

    const earlierDate = new Date(earlier);
    expect(earlierDate.getHours()).toBe(9);
    expect(earlierDate.getDate()).toBe(2);

    const laterDate = new Date(later);
    expect(laterDate.getHours()).toBe(11);
    expect(laterDate.getDate()).toBe(1);
  });

  test('computeNextRun falls back to +24h for invalid daily time', () => {
    const base = 1_000_000;
    expect(computeNextRun({ type: 'daily', time: 'bogus' }, base)).toBe(
      base + 24 * 60 * 60_000,
    );
  });

  test('computeNextRun for weekly skips non-matching days and falls back for empty input', () => {
    const base = new Date(2026, 0, 1, 10, 0, 0).getTime(); // Thursday
    const nextMonday = computeNextRun({ type: 'weekly', days: [1], time: '09:00' }, base)!;
    expect(new Date(nextMonday).getDay()).toBe(1);
    expect(new Date(nextMonday).getHours()).toBe(9);

    expect(computeNextRun({ type: 'weekly', days: [], time: '09:00' }, base)).toBe(
      base + 7 * 24 * 60 * 60_000,
    );
  });

  test('scheduleDisplay preserves the pre-S4 strings', () => {
    expect(scheduleDisplay({ type: 'interval', intervalMinutes: 30 })).toBe('Every 30m');
    expect(scheduleDisplay({ type: 'interval', intervalMinutes: 120 })).toBe('Every 2h');
    expect(scheduleDisplay({ type: 'interval', intervalMinutes: 90 })).toBe('Every 90m');
    expect(scheduleDisplay({ type: 'daily', time: '09:00' })).toBe('Daily at 09:00');
    expect(scheduleDisplay({ type: 'weekly', days: [1, 2, 3, 4, 5], time: '17:00' })).toBe(
      'Weekdays at 17:00',
    );
    expect(scheduleDisplay({ type: 'weekly', days: [], time: '17:00' })).toBe(
      'Weekly (no days set)',
    );
    expect(scheduleDisplay({ type: 'weekly', days: [0, 6], time: '08:00' })).toBe(
      'Sun, Sat at 08:00',
    );
    expect(scheduleDisplay({ type: 'once', runAt: '2030-01-01T00:00:00Z' })).toMatch(
      /^Once at /,
    );
  });
});

describe('scheduling domain: job lifecycle decisions', () => {
  test('advance completes one-shot jobs', () => {
    const job = makeJob({ scheduleKind: 'once', scheduleConfig: { type: 'once', runAt: '2030-01-01T00:00:00Z' } });
    expect(decideNextRunAfterAdvance(job, 1_000)).toEqual({ kind: 'complete' });
  });

  test('advance completes recurring jobs at the repeat limit boundary', () => {
    // runCount 1, limit 3: next run would be run 2, still under the limit.
    const under = makeJob({ repeatLimit: 3, runCount: 1 });
    expect(decideNextRunAfterAdvance(under, 1_000).kind).toBe('reschedule');

    // runCount 2, limit 3: next run would be run 3, reaching the limit.
    const at = makeJob({ repeatLimit: 3, runCount: 2 });
    expect(decideNextRunAfterAdvance(at, 1_000)).toEqual({ kind: 'complete' });
  });

  test('advance reschedules unlimited recurring jobs from the config', () => {
    const base = 1_000_000;
    const decision = decideNextRunAfterAdvance(makeJob(), base);
    expect(decision).toEqual({ kind: 'reschedule', nextRunAt: base + 60 * 60_000 });
  });

  test('update decisions mirror the pre-S4 store clauses', () => {
    const active = makeJob();
    const paused = makeJob({ state: 'paused', nextRunAt: null });
    const base = 1_000_000;

    // Pausing always nulls next_run_at, with or without a schedule change.
    expect(decideNextRunOnUpdate(active, { state: 'paused' }, base)).toEqual({
      kind: 'set',
      nextRunAt: null,
    });
    expect(
      decideNextRunOnUpdate(active, {
        state: 'paused',
        scheduleConfig: { type: 'interval', intervalMinutes: 30 },
      }, base),
    ).toEqual({ kind: 'set', nextRunAt: null });

    // An active schedule change recomputes from the new config.
    expect(
      decideNextRunOnUpdate(active, {
        scheduleConfig: { type: 'interval', intervalMinutes: 30 },
      }, base),
    ).toEqual({ kind: 'set', nextRunAt: base + 30 * 60_000 });

    // A schedule change on a paused job without a state change leaves it.
    expect(
      decideNextRunOnUpdate(paused, {
        scheduleConfig: { type: 'interval', intervalMinutes: 30 },
      }, base),
    ).toEqual({ kind: 'unchanged' });

    // Resuming a paused job recomputes from the existing config.
    expect(decideNextRunOnUpdate(paused, { state: 'active' }, base)).toEqual({
      kind: 'set',
      nextRunAt: base + 60 * 60_000,
    });

    // Unrelated updates leave next_run_at untouched.
    expect(decideNextRunOnUpdate(active, { name: 'Renamed' }, base)).toEqual({
      kind: 'unchanged',
    });
  });
});

describe('scheduling domain: notification policy', () => {
  test('scheduledSessionOrigin classifies metadata values', () => {
    expect(scheduledSessionOrigin(makeSession())).toEqual({ kind: 'none' });
    expect(scheduledSessionOrigin(makeSession({ metadata: {} }))).toEqual({ kind: 'none' });
    expect(scheduledSessionOrigin(makeSession({ metadata: { scheduledJobId: 'job-1' } }))).toEqual({
      kind: 'job',
      jobId: 'job-1',
    });
    expect(scheduledSessionOrigin(makeSession({ metadata: { scheduledJobId: 42 } }))).toEqual({
      kind: 'malformed',
    });
    expect(scheduledSessionOrigin(makeSession({ metadata: { scheduledJobId: true } }))).toEqual({
      kind: 'malformed',
    });
    expect(scheduledSessionOrigin(makeSession({ metadata: { scheduledJobId: '' } }))).toEqual({
      kind: 'malformed',
    });
  });

  test('canNotifyForSession reproduces the pre-S4 dispatch eligibility', () => {
    const getJob = (enabled: boolean | null) => (_id: string) =>
      enabled === null
        ? null
        : makeJob({ notificationsEnabled: enabled });

    // A null session never notifies.
    expect(canNotifyForSession(null, getJob(true))).toBe(false);

    // Ordinary sessions always notify.
    expect(canNotifyForSession(makeSession(), getJob(true))).toBe(true);
    expect(canNotifyForSession(makeSession({ metadata: {} }), getJob(true))).toBe(true);

    // Malformed scheduled-job ids fail closed.
    expect(canNotifyForSession(makeSession({ metadata: { scheduledJobId: 42 } }), getJob(true))).toBe(false);
    expect(canNotifyForSession(makeSession({ metadata: { scheduledJobId: '' } }), getJob(true))).toBe(false);

    // A missing job record fails closed.
    expect(
      canNotifyForSession(makeSession({ metadata: { scheduledJobId: 'gone' } }), getJob(null)),
    ).toBe(false);

    // Only an existing opted-in job notifies.
    expect(
      canNotifyForSession(makeSession({ metadata: { scheduledJobId: 'job-1' } }), getJob(false)),
    ).toBe(false);
    expect(
      canNotifyForSession(makeSession({ metadata: { scheduledJobId: 'job-1' } }), getJob(true)),
    ).toBe(true);
  });
});
