import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { createApp } from '@/transport/http/app';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';
import { seedWorkspace } from '#tests/seed';

interface SchedulerResponse {
  jobs: unknown[];
  error: string;
  job: {
    id: string;
    name: string;
    state: string;
    notificationsEnabled: boolean;
  };
  details: Array<{ path: string }>;
}

async function json(res: Response): Promise<SchedulerResponse> {
  return res.json() as Promise<SchedulerResponse>;
}

describe('Scheduler Routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    delete process.env.JEAN2_AUTH_TOKEN;
    setupTestDataDir();
    setupTestDatabase();
    app = createApp();
  });

  afterEach(() => {
    resetTestDatabase();
    resetTestDataDir();
  });

  // ── List Jobs ──────────────────────────────────────────────────

  describe('GET /api/workspaces/:workspaceId/scheduled-jobs', () => {
    test('returns empty list for workspace with no jobs', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/scheduled-jobs');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.jobs).toBeInstanceOf(Array);
      expect(body.jobs).toHaveLength(0);
    });

    test('returns 404 for missing workspace (no ws check, returns empty)', async () => {
      const res = await app.request('/api/workspaces/nonexistent/scheduled-jobs');
      expect(res.status).toBe(200);
    });
  });

  // ── Get Single Job ─────────────────────────────────────────────

  describe('GET /api/workspaces/:workspaceId/scheduled-jobs/:jobId', () => {
    test('returns 404 for missing job', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/scheduled-jobs/nonexistent');
      expect(res.status).toBe(404);

      const body = await json(res);
      expect(body.error).toBe('not_found');
    });
  });

  // ── Create Job ─────────────────────────────────────────────────

  describe('POST /api/workspaces/:workspaceId/scheduled-jobs', () => {
    test('creates a scheduled job', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/scheduled-jobs', {
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
      const body = await json(res);
      expect(body.job.name).toBe('Daily Report');
      expect(body.job.id).toBeDefined();
      expect(body.job.state).toBe('active');
      expect(body.job.notificationsEnabled).toBe(false);
    });

    test('creates a job with notificationsEnabled true', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/scheduled-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Daily Report',
          prompt: 'Generate a daily report',
          scheduleKind: 'daily',
          scheduleConfig: { type: 'daily', time: '09:00' },
          notificationsEnabled: true,
        }),
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.job.notificationsEnabled).toBe(true);
    });

    test('returns 400 for non-boolean notificationsEnabled', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/scheduled-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test',
          prompt: 'test',
          scheduleKind: 'daily',
          scheduleConfig: { type: 'daily', time: '09:00' },
          notificationsEnabled: 'yes',
        }),
      });

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toBe('bad_request');
    });

    test('returns 400 when name is missing', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/scheduled-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'test',
          scheduleKind: 'daily',
          scheduleConfig: { type: 'daily', time: '09:00' },
        }),
      });

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toBe('bad_request');
      expect(body.details.some((d: { path: string }) => d.path === 'name')).toBe(true);
    });

    test('returns 400 when prompt is missing', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/scheduled-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test',
          scheduleKind: 'daily',
          scheduleConfig: { type: 'daily', time: '09:00' },
        }),
      });

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toBe('bad_request');
    });

    test('returns 400 when scheduleKind is missing', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/scheduled-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test',
          prompt: 'test',
        }),
      });

      expect(res.status).toBe(400);
    });

    test('returns 404 for missing workspace', async () => {
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
      const body = await json(res);
      expect(body.error).toBe('not_found');
    });

    test('returns 400 for invalid autoApproveSeverity', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/scheduled-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test',
          prompt: 'test',
          scheduleKind: 'daily',
          scheduleConfig: { type: 'daily', time: '09:00' },
          autoApproveSeverity: 'invalid-level',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ── Update Job ─────────────────────────────────────────────────

  describe('PATCH /api/workspaces/:workspaceId/scheduled-jobs/:jobId', () => {
    test('returns 404 for missing job', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/scheduled-jobs/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });

    test('toggles notificationsEnabled via patch', async () => {
      seedWorkspace({ id: 'ws1' });

      const createRes = await app.request('/api/workspaces/ws1/scheduled-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Toggle',
          prompt: 'P',
          scheduleKind: 'interval',
          scheduleConfig: { type: 'interval', intervalMinutes: 60 },
        }),
      });
      const created = await json(createRes);
      const jobId = created.job.id;
      expect(created.job.notificationsEnabled).toBe(false);

      const enableRes = await app.request(`/api/workspaces/ws1/scheduled-jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationsEnabled: true }),
      });
      expect(enableRes.status).toBe(200);
      const enabled = await json(enableRes);
      expect(enabled.job.notificationsEnabled).toBe(true);

      const disableRes = await app.request(`/api/workspaces/ws1/scheduled-jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationsEnabled: false }),
      });
      expect(disableRes.status).toBe(200);
      const disabled = await json(disableRes);
      expect(disabled.job.notificationsEnabled).toBe(false);
    });
  });

  // ── Delete Job ─────────────────────────────────────────────────

  describe('DELETE /api/workspaces/:workspaceId/scheduled-jobs/:jobId', () => {
    test('returns 404 for missing job', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/scheduled-jobs/nonexistent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });

  // ── Pause/Resume ───────────────────────────────────────────────

  describe('POST /api/workspaces/:workspaceId/scheduled-jobs/:jobId/pause', () => {
    test('returns 404 for missing job', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/scheduled-jobs/nonexistent/pause', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/workspaces/:workspaceId/scheduled-jobs/:jobId/resume', () => {
    test('returns 404 for missing job', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/scheduled-jobs/nonexistent/resume', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
    });
  });

  // ── Full CRUD flow ─────────────────────────────────────────────

  describe('full job lifecycle', () => {
    test('create, get, pause, resume, delete', async () => {
      seedWorkspace({ id: 'ws1' });

      // Create
      const createRes = await app.request('/api/workspaces/ws1/scheduled-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Lifecycle Test',
          prompt: 'Do something',
          scheduleKind: 'interval',
          scheduleConfig: { type: 'interval', intervalMinutes: 60 },
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await json(createRes);
      const jobId = created.job.id;

      // Get
      const getRes = await app.request(`/api/workspaces/ws1/scheduled-jobs/${jobId}`);
      expect(getRes.status).toBe(200);
      const fetched = await json(getRes);
      expect(fetched.job.id).toBe(jobId);
      expect(fetched.job.state).toBe('active');

      // Pause
      const pauseRes = await app.request(`/api/workspaces/ws1/scheduled-jobs/${jobId}/pause`, {
        method: 'POST',
      });
      expect(pauseRes.status).toBe(200);
      const paused = await json(pauseRes);
      expect(paused.job.state).toBe('paused');

      // Resume
      const resumeRes = await app.request(`/api/workspaces/ws1/scheduled-jobs/${jobId}/resume`, {
        method: 'POST',
      });
      expect(resumeRes.status).toBe(200);
      const resumed = await json(resumeRes);
      expect(resumed.job.state).toBe('active');

      // Delete
      const deleteRes = await app.request(`/api/workspaces/ws1/scheduled-jobs/${jobId}`, {
        method: 'DELETE',
      });
      expect(deleteRes.status).toBe(200);

      // Verify gone
      const getAfterDelete = await app.request(`/api/workspaces/ws1/scheduled-jobs/${jobId}`);
      expect(getAfterDelete.status).toBe(404);
    });
  });
});
