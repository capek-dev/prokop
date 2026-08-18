import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createScheduledJobRepository } from '@/infrastructure/sqlite/scheduled-job-repository';

function makeRepository() {
  return createScheduledJobRepository(() => getDatabase());
}

describe('scheduled-job SQLite repository', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  afterEach(() => {
    resetTestDatabase();
  });

  describe('create', () => {
    test('creates a job with all fields and reads it back', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();

      const job = repository.create('ws1', {
        name: 'Daily reflection',
        prompt: 'Review recent work and extract lessons',
        scheduleKind: 'daily',
        scheduleConfig: { type: 'daily', time: '09:00' },
        repeatLimit: 10,
        reuseSession: true,
        includeHistory: false,
        preconfigId: 'agent-1',
        originSessionId: 'session-1',
        autoApproveSeverity: 'low',
        notificationsEnabled: true,
      });

      expect(job.id).toBeDefined();
      expect(job.workspaceId).toBe('ws1');
      expect(job.name).toBe('Daily reflection');
      expect(job.prompt).toBe('Review recent work and extract lessons');
      expect(job.scheduleKind).toBe('daily');
      expect(job.scheduleConfig).toEqual({ type: 'daily', time: '09:00' });
      expect(job.scheduleDisplay).toBe('Daily at 09:00');
      expect(job.state).toBe('active');
      expect(job.repeatLimit).toBe(10);
      expect(job.runCount).toBe(0);
      expect(job.nextRunAt).not.toBeNull();
      expect(job.lastRunAt).toBeNull();
      expect(job.lastRunSessionId).toBeNull();
      expect(job.lastError).toBeNull();
      expect(job.reuseSession).toBe(true);
      expect(job.includeHistory).toBe(false);
      expect(job.preconfigId).toBe('agent-1');
      expect(job.originSessionId).toBe('session-1');
      expect(job.autoApproveSeverity).toBe('low');
      expect(job.notificationsEnabled).toBe(true);
      expect(job.createdAt).toBeDefined();
      expect(job.updatedAt).toBeDefined();
    });

    test('creates a job with defaults (nulls and booleans)', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const job = makeRepository().create('ws1', {
        name: 'Simple job',
        prompt: 'Do something',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 30 },
      });

      expect(job.repeatLimit).toBeNull();
      expect(job.reuseSession).toBe(false);
      expect(job.includeHistory).toBe(false);
      expect(job.preconfigId).toBeNull();
      expect(job.originSessionId).toBeNull();
      expect(job.autoApproveSeverity).toBeNull();
      expect(job.notificationsEnabled).toBe(false);
    });

    test('computes nextRunAt for interval and weekly schedules', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();

      const interval = repository.create('ws1', {
        name: 'Every 2h',
        prompt: 'Run',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 120 },
      });
      const expected = Date.now() + 120 * 60_000;
      const actual = new Date(interval.nextRunAt!).getTime();
      expect(Math.abs(actual - expected)).toBeLessThan(5000);

      const weekly = repository.create('ws1', {
        name: 'Weekdays',
        prompt: 'Run',
        scheduleKind: 'weekly',
        scheduleConfig: { type: 'weekly', days: [1, 2, 3, 4, 5], time: '17:00' },
      });
      expect(weekly.nextRunAt).not.toBeNull();
      expect(weekly.scheduleDisplay).toBe('Weekdays at 17:00');
    });
  });

  describe('get and list', () => {
    test('returns null for a non-existent job', () => {
      expect(makeRepository().get('does-not-exist')).toBeNull();
    });

    test('lists only the jobs of the requested workspace', () => {
      seedWorkspace({ id: 'ws1', name: 'A', path: '/a' });
      seedWorkspace({ id: 'ws2', name: 'B', path: '/b' });
      const repository = makeRepository();

      const job1 = repository.create('ws1', {
        name: 'Job A',
        prompt: 'A',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });
      repository.create('ws2', {
        name: 'Job B',
        prompt: 'B',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      const jobs = repository.list('ws1');
      expect(jobs).toHaveLength(1);
      expect(jobs[0].id).toBe(job1.id);
      expect(repository.list('ws2')).toHaveLength(1);
    });
  });

  describe('update', () => {
    test('updates name and prompt', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();
      const job = repository.create('ws1', {
        name: 'Old',
        prompt: 'Old prompt',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      const updated = repository.update(job.id, { name: 'New name', prompt: 'New prompt' });
      expect(updated!.name).toBe('New name');
      expect(updated!.prompt).toBe('New prompt');
    });

    test('updates schedule and recomputes nextRunAt for active jobs', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();
      const job = repository.create('ws1', {
        name: 'Job',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });
      const originalNextRun = job.nextRunAt;

      const updated = repository.update(job.id, {
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 30 },
      });
      expect(updated!.scheduleDisplay).toBe('Every 30m');
      expect(updated!.nextRunAt).not.toBeNull();
      expect(updated!.nextRunAt).not.toBe(originalNextRun);
    });

    test('pausing nulls nextRunAt and resuming recomputes it', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();
      const job = repository.create('ws1', {
        name: 'Job',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      const paused = repository.update(job.id, { state: 'paused' });
      expect(paused!.state).toBe('paused');
      expect(paused!.nextRunAt).toBeNull();

      const resumed = repository.update(job.id, { state: 'active' });
      expect(resumed!.state).toBe('active');
      expect(resumed!.nextRunAt).not.toBeNull();
    });

    test('a schedule change on a paused job keeps nextRunAt null', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();
      const job = repository.create('ws1', {
        name: 'Job',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });
      repository.update(job.id, { state: 'paused' });

      const updated = repository.update(job.id, {
        scheduleConfig: { type: 'interval', intervalMinutes: 30 },
      });
      expect(updated!.scheduleDisplay).toBe('Every 30m');
      expect(updated!.nextRunAt).toBeNull();
    });

    test('toggles notificationsEnabled and preserves it on unrelated updates', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();
      const job = repository.create('ws1', {
        name: 'J',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });
      expect(job.notificationsEnabled).toBe(false);

      expect(repository.update(job.id, { notificationsEnabled: true })!.notificationsEnabled).toBe(true);
      expect(repository.update(job.id, { notificationsEnabled: false })!.notificationsEnabled).toBe(false);

      repository.update(job.id, { notificationsEnabled: true });
      expect(repository.update(job.id, { name: 'Renamed' })!.notificationsEnabled).toBe(true);
    });

    test('returns null for a non-existent job', () => {
      expect(makeRepository().update('nope', { name: 'x' })).toBeNull();
    });
  });

  describe('delete', () => {
    test('deletes a job and returns true, false for missing', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();
      const job = repository.create('ws1', {
        name: 'J',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      expect(repository.delete(job.id)).toBe(true);
      expect(repository.get(job.id)).toBeNull();
      expect(repository.delete('nope')).toBe(false);
    });

    test('deletes all jobs of a workspace', () => {
      seedWorkspace({ id: 'ws1', name: 'A', path: '/a' });
      seedWorkspace({ id: 'ws2', name: 'B', path: '/b' });
      const repository = makeRepository();
      const input = {
        name: 'J',
        prompt: 'P',
        scheduleKind: 'interval' as const,
        scheduleConfig: { type: 'interval' as const, intervalMinutes: 60 },
      };
      repository.create('ws1', input);
      repository.create('ws1', input);
      repository.create('ws2', input);

      expect(repository.deleteByWorkspace('ws1')).toBe(2);
      expect(repository.list('ws1')).toHaveLength(0);
      expect(repository.list('ws2')).toHaveLength(1);
    });
  });

  describe('tick queries', () => {
    test('getDue returns active jobs with nextRunAt <= now and excludes paused', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();
      const job = repository.create('ws1', {
        name: 'Due',
        prompt: 'P',
        scheduleKind: 'once',
        scheduleConfig: { type: 'once', runAt: new Date(Date.now() - 1000).toISOString() },
      });

      expect(repository.getDue(Date.now()).map((due) => due.id)).toEqual([job.id]);

      repository.update(job.id, { state: 'paused' });
      expect(repository.getDue(Date.now())).toHaveLength(0);
    });
  });

  describe('run bookkeeping', () => {
    test('markRun increments runCount and clears lastError', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();
      const job = repository.create('ws1', {
        name: 'J',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });
      repository.markError(job.id, 'Something went wrong');

      repository.markRun(job.id, 'session-run-1');

      const updated = repository.get(job.id)!;
      expect(updated.runCount).toBe(1);
      expect(updated.lastRunAt).not.toBeNull();
      expect(updated.lastRunSessionId).toBe('session-run-1');
      expect(updated.lastError).toBeNull();
    });

    test('markError sets lastError without changing runCount', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();
      const job = repository.create('ws1', {
        name: 'J',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      repository.markError(job.id, 'Something went wrong');

      const updated = repository.get(job.id)!;
      expect(updated.runCount).toBe(0);
      expect(updated.lastError).toBe('Something went wrong');
    });
  });

  describe('advance', () => {
    test('completes a one-shot job after its first run', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();
      const job = repository.create('ws1', {
        name: 'Once',
        prompt: 'P',
        scheduleKind: 'once',
        scheduleConfig: { type: 'once', runAt: new Date(Date.now() - 1000).toISOString() },
      });

      repository.markRun(job.id, 's1');
      repository.advance(job.id);

      const updated = repository.get(job.id)!;
      expect(updated.state).toBe('completed');
      expect(updated.nextRunAt).toBeNull();
    });

    test('completes a recurring job when the repeat limit is reached', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();
      const job = repository.create('ws1', {
        name: 'Limited',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
        repeatLimit: 3,
      });

      repository.markRun(job.id, 's1');
      repository.advance(job.id);
      expect(repository.get(job.id)!.state).toBe('active');

      repository.markRun(job.id, 's2');
      repository.advance(job.id);
      expect(repository.get(job.id)!.state).toBe('completed');
      expect(repository.get(job.id)!.nextRunAt).toBeNull();
    });

    test('reschedules a recurring job under the repeat limit', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();
      const job = repository.create('ws1', {
        name: 'Recurring',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      repository.markRun(job.id, 's1');
      repository.advance(job.id);

      const updated = repository.get(job.id)!;
      expect(updated.state).toBe('active');
      expect(updated.nextRunAt).not.toBeNull();
    });

    test('does nothing for a missing job', () => {
      expect(() => makeRepository().advance('nope')).not.toThrow();
    });
  });

  describe('markCompleted', () => {
    test('sets state to completed and clears nextRunAt', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });
      const repository = makeRepository();
      const job = repository.create('ws1', {
        name: 'J',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      repository.markCompleted(job.id);

      const updated = repository.get(job.id)!;
      expect(updated.state).toBe('completed');
      expect(updated.nextRunAt).toBeNull();
    });
  });
});
