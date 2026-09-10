import type { Hono } from 'hono';
import { z } from 'zod';
import type { createLearningHistoryApi } from '@/application/learning/history-api';
import { learningSettingsSchema, sessionLearningSettingsSchema } from '@/domains/learning/settings';
import { validate } from './validate';

export function registerLearningRoutes(app: Hono, api: ReturnType<typeof createLearningHistoryApi>): void {
  const base = '/api/workspaces/:workspaceId/learning';
  app.get(`${base}/runs`, c => c.json(api.list(c.req.param('workspaceId'))));
  app.get(`${base}/runs/:runId`, c => c.json(api.detail(c.req.param('workspaceId'), c.req.param('runId'))));
  app.post(`${base}/preview`, validate('json', z.object({ settings: learningSettingsSchema, reviewerId: z.string().min(1) }).strict()), async c => {
    const body = c.req.valid('json');
    return c.json(await api.preview(c.req.param('workspaceId'), body.settings, body.reviewerId));
  });
  app.post(`${base}/runs/:runId/changes/:changeId/undo`, async c => c.json(await api.undo(c.req.param('workspaceId'), c.req.param('runId'), c.req.param('changeId'))));
  app.post(`${base}/runs/:runId/keep-current`, validate('json', z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict()), c =>
    c.json(api.keepCurrent(c.req.param('workspaceId'), c.req.param('runId'), c.req.valid('json').revision)));
  app.patch('/api/sessions/:sessionId/learning', validate('json', sessionLearningSettingsSchema), c =>
    c.json(api.exclusion(c.req.param('sessionId'), c.req.valid('json'))));
}
