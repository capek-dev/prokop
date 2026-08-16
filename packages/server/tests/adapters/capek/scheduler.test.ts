import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSchedulerHost, getSchedulerHost } from '@capekai/core/compat/jean2';
import {
  configureJean2SchedulerHost,
  jean2SchedulerHost,
} from '@/adapters/capek/scheduler';
import {
  createScheduledJob,
  deleteScheduledJob,
  getScheduledJob,
  listScheduledJobs,
  updateScheduledJob,
} from '@/store/scheduled-jobs';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { resetTestDataDir, setupTestDataDir } from '#tests/test-dir';

describe('Čapek scheduler adapter', () => {
  beforeEach(() => {
    setupTestDatabase();
    setupTestDataDir();
  });

  afterEach(() => {
    configureSchedulerHost();
    resetTestDatabase();
    resetTestDataDir();
  });

  test('wraps the exact scheduler store operations by identity', () => {
    expect(Object.keys(jean2SchedulerHost).sort()).toEqual(
      ['create', 'delete', 'get', 'list', 'trigger', 'update'].sort(),
    );
    expect(jean2SchedulerHost.create).toBe(createScheduledJob);
    expect(jean2SchedulerHost.get).toBe(getScheduledJob);
    expect(jean2SchedulerHost.list).toBe(listScheduledJobs);
    expect(jean2SchedulerHost.update).toBe(updateScheduledJob);
    expect(jean2SchedulerHost.delete).toBe(deleteScheduledJob);
  });

  test('trigger is fire-and-forget, returns immediately, and reports the rejection exactly once', async () => {
    // Deterministic acknowledgement: resolves exactly when the rejection
    // handler emits its console.error, so no fixed sleep is involved.
    let acknowledge: (() => void) | undefined;
    const rejectionReported = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const captured: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      captured.push(args);
      if (String(args[0]).includes("[scheduler-tool] Trigger of 'broken-job' failed:")) {
        acknowledge?.();
      }
    };

    try {
      const result = jean2SchedulerHost.trigger({
        id: 'job-1',
        name: 'broken-job',
        workspaceId: 'workspace-1',
      } as never);
      expect(result).toBeUndefined();
      await rejectionReported;
    } finally {
      console.error = originalError;
    }

    const schedulerErrors = captured.filter((args) => String(args[0]).includes('[scheduler-tool]'));
    expect(schedulerErrors).toHaveLength(1);
    expect(String(schedulerErrors[0][0])).toContain("[scheduler-tool] Trigger of 'broken-job' failed:");
  });

  test('installs the module-level scheduler host by identity', () => {
    configureJean2SchedulerHost();
    expect(getSchedulerHost()).toBe(jean2SchedulerHost);
  });
});
