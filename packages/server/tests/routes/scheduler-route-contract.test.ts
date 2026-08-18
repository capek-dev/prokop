import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { registerSchedulerRoutes } from '@/routes/scheduler';
import { HttpError } from '@/application/http-errors';
import type { SchedulingHttpApplication } from '@/application/scheduling';
import type { ScheduledJob } from '@jean2/sdk';

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

function makeFakeApplication(overrides: Partial<SchedulingHttpApplication> = {}): SchedulingHttpApplication {
  return {
    listJobs: () => [makeJob()],
    getJob: () => makeJob(),
    createJob: () => ({ kind: 'created', job: makeJob() }),
    updateJob: () => makeJob(),
    deleteJob: () => true,
    pauseJob: () => makeJob({ state: 'paused' }),
    resumeJob: () => makeJob({ state: 'active' }),
    triggerJob: () => makeJob(),
    deleteJobsByWorkspace: () => 0,
    ...overrides,
  };
}

function makeApp(application: SchedulingHttpApplication): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      const body: Record<string, unknown> = { error: err.code, message: err.message };
      if (err.details !== undefined) {
        body.details = err.details;
      }
      return c.json(body, err.status as never);
    }
    return c.json({ error: 'Internal Server Error', message: String(err) }, 500 as never);
  });
  registerSchedulerRoutes(app, application);
  return app;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

describe('scheduler route contract', () => {
  test('GET list returns the application jobs', async () => {
    const app = makeApp(makeFakeApplication());
    const res = await app.request('/api/workspaces/ws-1/scheduled-jobs');
    expect(res.status).toBe(200);
    expect((await json(res)).jobs as unknown[]).toHaveLength(1);
  });

  test('GET job returns 404 with the exact error body for a missing job', async () => {
    const app = makeApp(makeFakeApplication({ getJob: () => null }));
    const res = await app.request('/api/workspaces/ws-1/scheduled-jobs/missing');
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({
      error: 'not_found',
      message: 'Scheduled job not found',
    });
  });

  test('POST create passes the raw body to the application and returns 201', async () => {
    const captured: Array<{ workspaceId: string; input: unknown }> = [];
    const app = makeApp(
      makeFakeApplication({
        createJob: (workspaceId, input) => {
          captured.push({ workspaceId, input });
          return { kind: 'created', job: makeJob() };
        },
      }),
    );

    const res = await app.request('/api/workspaces/ws-1/scheduled-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Daily Report',
        prompt: 'Generate a daily report',
        scheduleKind: 'daily',
        scheduleConfig: { type: 'daily', time: '09:00' },
      }),
    });

    expect(res.status).toBe(201);
    expect((await json(res)).job).toEqual(expect.objectContaining({ id: 'job-1' }));
    expect(captured[0]).toEqual({
      workspaceId: 'ws-1',
      input: {
        name: 'Daily Report',
        prompt: 'Generate a daily report',
        scheduleKind: 'daily',
        scheduleConfig: { type: 'daily', time: '09:00' },
        repeatLimit: undefined,
        preconfigId: undefined,
        originSessionId: undefined,
        reuseSession: undefined,
        includeHistory: undefined,
        autoApproveSeverity: undefined,
        notificationsEnabled: undefined,
      },
    });
  });

  test('POST create passes padded values through raw: trimming is the use case job', async () => {
    let captured: unknown = null;
    const app = makeApp(
      makeFakeApplication({
        createJob: (_workspaceId, input) => {
          captured = input;
          return { kind: 'created', job: makeJob() };
        },
      }),
    );

    const res = await app.request('/api/workspaces/ws-1/scheduled-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '  Padded  ',
        prompt: '  Padded prompt  ',
        scheduleKind: 'daily',
        scheduleConfig: { type: 'daily', time: '09:00' },
      }),
    });

    expect(res.status).toBe(201);
    const input = captured as { name: string; prompt: string };
    expect(input.name).toBe('  Padded  ');
    expect(input.prompt).toBe('  Padded prompt  ');
  });

  test('PATCH passes padded name and prompt through untrimmed like pre-S4', async () => {
    let updates: unknown = null;
    const app = makeApp(
      makeFakeApplication({
        updateJob: (_id, input) => {
          updates = input;
          return makeJob();
        },
      }),
    );

    const res = await app.request('/api/workspaces/ws-1/scheduled-jobs/job-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  Padded name  ', prompt: '  Padded prompt  ' }),
    });

    expect(res.status).toBe(200);
    expect(updates).toEqual({ name: '  Padded name  ', prompt: '  Padded prompt  ' });
  });

  test('POST create maps workspace_not_found to the exact 404 body', async () => {
    const app = makeApp(
      makeFakeApplication({ createJob: () => ({ kind: 'workspace_not_found' }) }),
    );
    const res = await app.request('/api/workspaces/nonexistent/scheduled-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test',
        prompt: 'test',
        scheduleKind: 'daily',
        scheduleConfig: { type: 'daily', time: '09:00' },
      }),
    });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({
      error: 'not_found',
      message: 'Workspace not found',
    });
  });

  test('POST create returns 400 with bad_request for missing required fields', async () => {
    const app = makeApp(makeFakeApplication());
    const res = await app.request('/api/workspaces/ws-1/scheduled-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('bad_request');
  });

  test('PATCH returns 404 for a missing job and passes updates through', async () => {
    let updates: unknown = null;
    const app = makeApp(
      makeFakeApplication({
        updateJob: (id, input) => {
          updates = input;
          return makeJob();
        },
      }),
    );

    const ok = await app.request('/api/workspaces/ws-1/scheduled-jobs/job-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(ok.status).toBe(200);
    expect(updates).toEqual({ name: 'Updated' });

    const appMissing = makeApp(makeFakeApplication({ updateJob: () => null }));
    const missing = await appMissing.request('/api/workspaces/ws-1/scheduled-jobs/nope', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(missing.status).toBe(404);
    expect((await json(missing)).message).toBe('Scheduled job not found');
  });

  test('DELETE returns success:true or the exact 404 body', async () => {
    const app = makeApp(makeFakeApplication());
    const ok = await app.request('/api/workspaces/ws-1/scheduled-jobs/job-1', {
      method: 'DELETE',
    });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({ success: true });

    const appMissing = makeApp(makeFakeApplication({ deleteJob: () => false }));
    const missing = await appMissing.request('/api/workspaces/ws-1/scheduled-jobs/nope', {
      method: 'DELETE',
    });
    expect(missing.status).toBe(404);
  });

  test('pause and resume invoke the use cases and map 404s', async () => {
    const app = makeApp(makeFakeApplication());
    const paused = await app.request('/api/workspaces/ws-1/scheduled-jobs/job-1/pause', {
      method: 'POST',
    });
    expect(paused.status).toBe(200);
    expect((await json(paused)).job).toEqual(expect.objectContaining({ state: 'paused' }));

    const resumed = await app.request('/api/workspaces/ws-1/scheduled-jobs/job-1/resume', {
      method: 'POST',
    });
    expect(resumed.status).toBe(200);
    expect((await json(resumed)).job).toEqual(expect.objectContaining({ state: 'active' }));

    const appMissing = makeApp(makeFakeApplication({ pauseJob: () => null }));
    const missing = await appMissing.request('/api/workspaces/ws-1/scheduled-jobs/nope/pause', {
      method: 'POST',
    });
    expect(missing.status).toBe(404);
  });

  test('trigger invokes the use case and returns the exact success body', async () => {
    const triggered: string[] = [];
    const app = makeApp(
      makeFakeApplication({
        triggerJob: (id) => {
          triggered.push(id);
          return makeJob({ id });
        },
      }),
    );

    const res = await app.request('/api/workspaces/ws-1/scheduled-jobs/job-1/trigger', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ success: true, message: 'Job triggered' });
    expect(triggered).toEqual(['job-1']);

    const appMissing = makeApp(makeFakeApplication({ triggerJob: () => null }));
    const missing = await appMissing.request('/api/workspaces/ws-1/scheduled-jobs/nope/trigger', {
      method: 'POST',
    });
    expect(missing.status).toBe(404);
  });
});
