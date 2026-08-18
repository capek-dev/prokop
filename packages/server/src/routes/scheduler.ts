import type { Hono } from 'hono';
import type { CreateScheduledJobInput, UpdateScheduledJobInput } from '@jean2/sdk';
import type { SchedulingHttpApplication } from '@/application/scheduling';
import { validate } from './validate';
import { NotFoundError } from '@/application/http-errors';
import { createScheduledJobSchema, updateScheduledJobSchema } from './schemas';

/**
 * S4 scheduled-job routes. Input validation, status mapping, and wire
 * presentation stay here; every operation invokes the scheduling HTTP
 * application use cases. The route imports no store, runner, or Capek
 * modules.
 */
export function registerSchedulerRoutes(app: Hono, application: SchedulingHttpApplication): void {
  app.get('/api/workspaces/:workspaceId/scheduled-jobs', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const jobs = application.listJobs(workspaceId);
    return c.json({ jobs });
  });

  app.get('/api/workspaces/:workspaceId/scheduled-jobs/:jobId', async (c) => {
    const jobId = c.req.param('jobId');
    const job = application.getJob(jobId);
    if (!job) {
      throw new NotFoundError('Scheduled job not found');
    }
    return c.json({ job });
  });

  app.post(
    '/api/workspaces/:workspaceId/scheduled-jobs',
    validate('json', createScheduledJobSchema),
    async (c) => {
      const workspaceId = c.req.param('workspaceId');
      const body = c.req.valid('json');

      const result = application.createJob(workspaceId, {
        name: body.name,
        prompt: body.prompt,
        scheduleKind: body.scheduleKind as CreateScheduledJobInput['scheduleKind'],
        scheduleConfig: body.scheduleConfig as unknown as CreateScheduledJobInput['scheduleConfig'],
        repeatLimit: body.repeatLimit,
        preconfigId: body.preconfigId,
        originSessionId: body.originSessionId,
        reuseSession: body.reuseSession,
        includeHistory: body.includeHistory,
        autoApproveSeverity: body.autoApproveSeverity,
        notificationsEnabled: body.notificationsEnabled,
      });
      if (result.kind === 'workspace_not_found') {
        throw new NotFoundError('Workspace not found');
      }
      return c.json({ job: result.job }, 201);
    },
  );

  app.patch(
    '/api/workspaces/:workspaceId/scheduled-jobs/:jobId',
    validate('json', updateScheduledJobSchema),
    async (c) => {
      const jobId = c.req.param('jobId');
      const body = c.req.valid('json');
      const updated = application.updateJob(
        jobId,
        body as unknown as UpdateScheduledJobInput,
      );
      if (!updated) {
        throw new NotFoundError('Scheduled job not found');
      }
      return c.json({ job: updated });
    },
  );

  app.delete('/api/workspaces/:workspaceId/scheduled-jobs/:jobId', async (c) => {
    const jobId = c.req.param('jobId');
    const deleted = application.deleteJob(jobId);
    if (!deleted) {
      throw new NotFoundError('Scheduled job not found');
    }
    return c.json({ success: true });
  });

  app.post('/api/workspaces/:workspaceId/scheduled-jobs/:jobId/pause', async (c) => {
    const jobId = c.req.param('jobId');
    const updated = application.pauseJob(jobId);
    if (!updated) {
      throw new NotFoundError('Scheduled job not found');
    }
    return c.json({ job: updated });
  });

  app.post('/api/workspaces/:workspaceId/scheduled-jobs/:jobId/resume', async (c) => {
    const jobId = c.req.param('jobId');
    const updated = application.resumeJob(jobId);
    if (!updated) {
      throw new NotFoundError('Scheduled job not found');
    }
    return c.json({ job: updated });
  });

  app.post('/api/workspaces/:workspaceId/scheduled-jobs/:jobId/trigger', async (c) => {
    const jobId = c.req.param('jobId');
    const job = application.triggerJob(jobId);
    if (!job) {
      throw new NotFoundError('Scheduled job not found');
    }

    return c.json({ success: true, message: 'Job triggered' });
  });
}
