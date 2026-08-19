import { afterEach, describe, expect, test } from 'bun:test';
import { configureSchedulerHost, getSchedulerHost } from '@capekai/core/hosts';
import {
  configureJean2SchedulerHost,
  jean2SchedulerHost,
  type Jean2SchedulerHostDeps,
} from '@/adapters/capek/scheduler';
import type { ScheduledJob } from '@jean2/sdk';
import type {
  ScheduledJobExecutionPort,
  ScheduledJobRepositoryPort,
} from '@/application/ports/scheduling';

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'job-1',
    workspaceId: 'ws-1',
    name: 'test-job',
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

function makeDeps(overrides: Partial<Jean2SchedulerHostDeps> = {}): Jean2SchedulerHostDeps {
  return {
    repository: {
      create: () => makeJob(),
      get: () => null,
      list: () => [],
      update: () => null,
      delete: () => false,
      deleteByWorkspace: () => 0,
      getDue: () => [],
      markRun: () => {},
      markError: () => {},
      advance: () => {},
      markCompleted: () => {},
    },
    execution: {
      run: async () => {},
      trigger: () => {},
    },
    ...overrides,
  };
}

describe('Čapek scheduler adapter', () => {
  afterEach(() => {
    configureSchedulerHost();
    configureJean2SchedulerHost();
  });

  test('exposes the exact host method keys by identity', () => {
    expect(Object.keys(jean2SchedulerHost).sort()).toEqual(
      ['create', 'delete', 'get', 'list', 'trigger', 'update'].sort(),
    );
  });

  test('delegates every repository operation to the configured deps', () => {
    const calls: string[] = [];
    const repository = {
      create: (workspaceId: string) => {
        calls.push(`create:${workspaceId}`);
        return makeJob();
      },
      get: (id: string) => {
        calls.push(`get:${id}`);
        return null;
      },
      list: (workspaceId: string) => {
        calls.push(`list:${workspaceId}`);
        return [];
      },
      update: (id: string) => {
        calls.push(`update:${id}`);
        return null;
      },
      delete: (id: string) => {
        calls.push(`delete:${id}`);
        return false;
      },
      deleteByWorkspace: () => 0,
      getDue: () => [],
      markRun: () => {},
      markError: () => {},
      advance: () => {},
      markCompleted: () => {},
    } satisfies ScheduledJobRepositoryPort;

    configureJean2SchedulerHost({
      repository,
      execution: { run: async () => {}, trigger: () => {} },
    });

    jean2SchedulerHost.create('ws-1', {
      name: 'J',
      prompt: 'P',
      scheduleKind: 'interval',
      scheduleConfig: { type: 'interval', intervalMinutes: 60 },
    });
    jean2SchedulerHost.get('job-1');
    jean2SchedulerHost.list('ws-1');
    jean2SchedulerHost.update('job-1', { name: 'Renamed' });
    jean2SchedulerHost.delete('job-1');

    expect(calls).toEqual([
      'create:ws-1',
      'get:job-1',
      'list:ws-1',
      'update:job-1',
      'delete:job-1',
    ]);
  });

  test('create throws the unconfigured-host error when no deps are installed', () => {
    configureJean2SchedulerHost();
    expect(() =>
      jean2SchedulerHost.create('ws-1', {
        name: 'J',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      }),
    ).toThrow('Scheduler host is not configured');
  });

  test('unconfigured read operations answer with the empty-host semantics', () => {
    configureJean2SchedulerHost();
    expect(jean2SchedulerHost.get('job-1')).toBeNull();
    expect(jean2SchedulerHost.list('ws-1')).toEqual([]);
    expect(jean2SchedulerHost.update('job-1', { name: 'X' })).toBeNull();
    expect(jean2SchedulerHost.delete('job-1')).toBe(false);
    expect(jean2SchedulerHost.trigger(makeJob())).toBeUndefined();
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

    const run = async (): Promise<void> => {
      throw new Error('run exploded');
    };
    configureJean2SchedulerHost({
      repository: makeDeps().repository,
      execution: { run, trigger: () => {} } satisfies ScheduledJobExecutionPort,
    });

    try {
      const result = jean2SchedulerHost.trigger(makeJob({ name: 'broken-job' }));
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
    configureJean2SchedulerHost(makeDeps());
    expect(getSchedulerHost()).toBe(jean2SchedulerHost);
  });
});
