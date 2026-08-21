import { describe, expect, test } from 'bun:test';
import type { ScheduledJob, Workspace } from '@prokopai/sdk';
import {
  createSchedulingHttpApplication,
  type SchedulingHttpApplication,
} from '@/application/scheduling/jobs';
import {
  createSchedulingTicker,
  SCHEDULER_TICK_INTERVAL_MS,
} from '@/application/scheduling/ticker';
import type {
  ScheduledJobExecutionPort,
  ScheduledJobRepositoryPort,
  ScheduledJobWorkspacePort,
} from '@/application/ports/scheduling';

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

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    name: 'Workspace',
    path: '/ws',
    ...overrides,
  } as Workspace;
}

interface FakeState {
  repository: ScheduledJobRepositoryPort;
  workspaces: ScheduledJobWorkspacePort;
  execution: ScheduledJobExecutionPort;
  log: string[];
}

function makeFakes(overrides: Partial<FakeState> = {}): FakeState {
  const log: string[] = [];
  const base: FakeState = {
    log,
    repository: {
      create: (workspaceId) => {
        log.push(`create:${workspaceId}`);
        return makeJob({ workspaceId });
      },
      get: (id) => {
        log.push(`get:${id}`);
        return id === 'job-1' ? makeJob() : null;
      },
      list: (workspaceId) => {
        log.push(`list:${workspaceId}`);
        return [];
      },
      update: (id, updates) => {
        log.push(`update:${id}:${JSON.stringify(updates)}`);
        return id === 'job-1' ? makeJob({ ...updates } as Partial<ScheduledJob>) : null;
      },
      delete: (id) => {
        log.push(`delete:${id}`);
        return id === 'job-1';
      },
      deleteByWorkspace: (workspaceId) => {
        log.push(`deleteByWorkspace:${workspaceId}`);
        return 2;
      },
      getDue: (now) => {
        log.push(`getDue:${now}`);
        return [];
      },
      markRun: (id, sessionId) => log.push(`markRun:${id}:${sessionId}`),
      markError: (id, error) => log.push(`markError:${id}:${error}`),
      advance: (id) => log.push(`advance:${id}`),
      markCompleted: (id) => log.push(`markCompleted:${id}`),
    },
    workspaces: {
      getWorkspace: (id) => {
        log.push(`workspace:${id}`);
        return id === 'ws-1' ? makeWorkspace({ id }) : null;
      },
    },
    execution: {
      run: async (job) => {
        log.push(`run:${job.id}`);
      },
      trigger: (job) => {
        log.push(`trigger:${job.id}`);
      },
    },
    ...overrides,
  };
  return base;
}

interface PatchedTimers {
  intervalCallbacks: Array<() => void>;
  cleared: unknown[];
  registrationCount: number;
  restore(): void;
}

/** Test-only timer seam: captures setInterval/clearInterval registrations so
 * the ticker lifecycle can be pinned without fake timers or real waits. */
function patchTimers(): PatchedTimers {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const state: PatchedTimers = {
    intervalCallbacks: [],
    cleared: [],
    registrationCount: 0,
    restore() {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    },
  };

  globalThis.setInterval = ((callback: () => void) => {
    state.registrationCount += 1;
    state.intervalCallbacks.push(callback);
    return state.registrationCount as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;

  globalThis.clearInterval = ((handle: ReturnType<typeof setInterval>) => {
    state.cleared.push(handle);
  }) as typeof clearInterval;

  return state;
}

function withCapturedLog(callback: (logs: unknown[][]) => void): void {
  const logs: unknown[][] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args);
  try {
    callback(logs);
  } finally {
    console.log = originalLog;
  }
}

function makeApplication(fakes: FakeState): SchedulingHttpApplication {
  return createSchedulingHttpApplication({
    repository: fakes.repository,
    workspaces: fakes.workspaces,
    execution: fakes.execution,
  });
}

describe('scheduling HTTP use cases', () => {
  test('listJobs and getJob delegate to the repository', () => {
    const fakes = makeFakes();
    const application = makeApplication(fakes);

    expect(application.listJobs('ws-1')).toEqual([]);
    expect(application.getJob('job-1')?.id).toBe('job-1');
    expect(application.getJob('missing')).toBeNull();
  });

  test('createJob checks the workspace first and trims name and prompt', () => {
    const fakes = makeFakes();
    const application = makeApplication(fakes);

    const missing = application.createJob('missing-ws', {
      name: ' J ',
      prompt: ' P ',
      scheduleKind: 'interval',
      scheduleConfig: { type: 'interval', intervalMinutes: 60 },
    });
    expect(missing).toEqual({ kind: 'workspace_not_found' });

    const created = application.createJob('ws-1', {
      name: ' J ',
      prompt: ' P ',
      scheduleKind: 'interval',
      scheduleConfig: { type: 'interval', intervalMinutes: 60 },
    });
    expect(created.kind).toBe('created');
  });

  test('createJob applies the pre-S4 default normalization', () => {
    const fakes = makeFakes();
    let captured: unknown = null;
    fakes.repository.create = (workspaceId, input) => {
      captured = input;
      return makeJob();
    };
    const application = makeApplication(fakes);

    application.createJob('ws-1', {
      name: 'J',
      prompt: 'P',
      scheduleKind: 'interval',
      scheduleConfig: { type: 'interval', intervalMinutes: 60 },
    });

    expect(captured).toEqual({
      name: 'J',
      prompt: 'P',
      scheduleKind: 'interval',
      scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      repeatLimit: null,
      reuseSession: false,
      includeHistory: false,
      preconfigId: null,
      originSessionId: null,
      autoApproveSeverity: null,
      notificationsEnabled: false,
    });
  });

  test('createJob trims padded name and prompt before creating', () => {
    const fakes = makeFakes();
    let captured: unknown = null;
    fakes.repository.create = (_workspaceId, input) => {
      captured = input;
      return makeJob();
    };
    const application = makeApplication(fakes);

    application.createJob('ws-1', {
      name: '  Padded name  ',
      prompt: '  Padded prompt  ',
      scheduleKind: 'interval',
      scheduleConfig: { type: 'interval', intervalMinutes: 60 },
    });

    const input = captured as { name: string; prompt: string };
    expect(input.name).toBe('Padded name');
    expect(input.prompt).toBe('Padded prompt');
  });

  test('updateJob passes padded name and prompt through untrimmed like pre-S4 PATCH', () => {
    const fakes = makeFakes();
    let captured: unknown = null;
    fakes.repository.update = (_id, updates) => {
      captured = updates;
      return makeJob();
    };
    const application = makeApplication(fakes);

    application.updateJob('job-1', { name: '  Padded name  ', prompt: '  Padded prompt  ' });

    expect(captured).toEqual({ name: '  Padded name  ', prompt: '  Padded prompt  ' });
  });

  test('pauseJob and resumeJob issue the state commands through update', () => {
    const fakes = makeFakes();
    const application = makeApplication(fakes);

    expect(application.pauseJob('job-1')?.state).toBe('paused');
    expect(application.resumeJob('job-1')?.state).toBe('active');
    expect(application.pauseJob('missing')).toBeNull();

    expect(fakes.log).toContain('update:job-1:{"state":"paused"}');
    expect(fakes.log).toContain('update:job-1:{"state":"active"}');
  });

  test('triggerJob fetches the job and fires the execution trigger once', () => {
    const fakes = makeFakes();
    const application = makeApplication(fakes);

    const job = application.triggerJob('job-1');
    expect(job?.id).toBe('job-1');
    expect(fakes.log.filter((entry) => entry === 'trigger:job-1')).toHaveLength(1);

    expect(application.triggerJob('missing')).toBeNull();
    expect(fakes.log.filter((entry) => entry.startsWith('trigger:'))).toHaveLength(1);
  });

  test('deleteJob and deleteJobsByWorkspace delegate', () => {
    const fakes = makeFakes();
    const application = makeApplication(fakes);

    expect(application.deleteJob('job-1')).toBe(true);
    expect(application.deleteJob('missing')).toBe(false);
    expect(application.deleteJobsByWorkspace('ws-1')).toBe(2);
  });
});

describe('scheduling ticker', () => {
  test('pins the 60 second tick interval', () => {
    expect(SCHEDULER_TICK_INTERVAL_MS).toBe(60_000);
  });

  test('tick does nothing when no jobs are due', async () => {
    const fakes = makeFakes();
    const ticker = createSchedulingTicker({
      repository: fakes.repository,
      execution: fakes.execution,
    });

    await ticker.tick();
    expect(fakes.log.filter((entry) => entry.startsWith('run:'))).toHaveLength(0);
    expect(fakes.log.filter((entry) => entry.startsWith('advance:'))).toHaveLength(0);
  });

  test('tick advances each due job before executing it', async () => {
    const fakes = makeFakes();
    fakes.repository.getDue = () => [makeJob({ id: 'a' }), makeJob({ id: 'b' })];
    const ticker = createSchedulingTicker({
      repository: fakes.repository,
      execution: fakes.execution,
    });

    await ticker.tick();

    const order = fakes.log.filter((entry) =>
      entry.startsWith('advance:') || entry.startsWith('run:'),
    );
    expect(order).toEqual(['advance:a', 'run:a', 'advance:b', 'run:b']);
  });

  test('tick marks failed runs with the exact error message and log prefix', async () => {
    const fakes = makeFakes();
    fakes.repository.getDue = () => [makeJob({ id: 'broken', name: 'broken' })];
    fakes.execution.run = async () => {
      throw new Error('kaboom');
    };

    const captured: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => captured.push(args);
    try {
      const ticker = createSchedulingTicker({
        repository: fakes.repository,
        execution: fakes.execution,
      });
      await ticker.tick();
      // Let the rejection handler run.
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      console.error = originalError;
    }

    expect(captured).toEqual([["[scheduler] Job 'broken' failed:", 'kaboom']]);
    expect(fakes.log).toContain('markError:broken:kaboom');
  });
});

describe('scheduling ticker lifecycle', () => {
  test('start runs an immediate startup tick before any interval fires', () => {
    const fakes = makeFakes();
    const timers = patchTimers();
    withCapturedLog((logs) => {
      try {
        const ticker = createSchedulingTicker({
          repository: fakes.repository,
          execution: fakes.execution,
        });
        ticker.start();

        // The startup tick calls getDue synchronously; the captured interval
        // callback has not fired.
        expect(fakes.log.filter((entry) => entry.startsWith('getDue:'))).toHaveLength(1);
        expect(timers.registrationCount).toBe(1);
        expect(logs.some((args) => String(args[0]) === '[scheduler] Starting scheduler (60s tick interval)')).toBe(true);
      } finally {
        timers.restore();
      }
    });
  });

  test('double start registers a single interval and the captured callback runs the tick', () => {
    const fakes = makeFakes();
    const timers = patchTimers();
    withCapturedLog((logs) => {
      try {
        const ticker = createSchedulingTicker({
          repository: fakes.repository,
          execution: fakes.execution,
        });
        ticker.start();
        ticker.start();

        expect(timers.registrationCount).toBe(1);
        expect(timers.intervalCallbacks).toHaveLength(1);
        expect(logs.filter((args) => String(args[0]).startsWith('[scheduler] Starting scheduler'))).toHaveLength(1);
        expect(fakes.log.filter((entry) => entry.startsWith('getDue:'))).toHaveLength(1);

        timers.intervalCallbacks[0]();

        expect(fakes.log.filter((entry) => entry.startsWith('getDue:'))).toHaveLength(2);
      } finally {
        timers.restore();
      }
    });
  });

  test('stop clears the registered interval, a second stop is a no-op, and restart re-registers', () => {
    const fakes = makeFakes();
    const timers = patchTimers();
    withCapturedLog((logs) => {
      try {
        const ticker = createSchedulingTicker({
          repository: fakes.repository,
          execution: fakes.execution,
        });
        ticker.start();
        ticker.stop();

        expect(timers.cleared).toHaveLength(1);
        expect(logs.filter((args) => String(args[0]) === '[scheduler] Stopped scheduler')).toHaveLength(1);

        ticker.stop();

        expect(timers.cleared).toHaveLength(1);
        expect(logs.filter((args) => String(args[0]) === '[scheduler] Stopped scheduler')).toHaveLength(1);

        ticker.start();

        expect(timers.registrationCount).toBe(2);
        expect(fakes.log.filter((entry) => entry.startsWith('getDue:'))).toHaveLength(2);
      } finally {
        timers.restore();
      }
    });
  });
});
