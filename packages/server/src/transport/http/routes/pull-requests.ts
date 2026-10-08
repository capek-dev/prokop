import type { Hono } from 'hono';
import { z } from 'zod';
import type { PullRequestsApplication } from '@/application/pull-requests';
import { validate } from './validate';

const text = z.string().max(60_000);
const noControls = (value: string) =>
  ![...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const branch = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (v) =>
      noControls(v) &&
      !v.startsWith('-') &&
      !/[\s~^:?*[\\]/.test(v) &&
      !v.includes('..') &&
      !v.includes('@{'),
    'Invalid branch',
  );
const scope = z.object({
  root: z.string().min(1).max(4096).optional(),
  remote: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
    .max(200),
  repositoryKey: z.string().min(1).max(1500),
});
const head = z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/);
const page = z.coerce.number().int().min(1).max(10_000).default(1);
const position = z
  .object({
    path: z.string().min(1).max(4096).refine(noControls),
    line: z.number().int().min(1).max(10_000_000),
    side: z.enum(['LEFT', 'RIGHT']),
    iteration: z.number().int().positive().optional(),
    changeTrackingId: z.number().int().positive().optional(),
  })
  .strict();
const guard = { expectedHead: head, accountId: z.string().min(1).max(500), ...scope.shape };
const commentBody = text.refine((v) => v.trim().length > 0, 'Enter a comment');
export const pullRequestActionSchema = z.discriminatedUnion('action', [
  z
    .object({ ...guard, action: z.literal('edit'), title: z.string().trim().min(1).max(300), body: text })
    .strict(),
  ...(['close', 'reopen', 'ready', 'draft', 'disable-auto-merge'] as const).map((action) =>
    z.object({ ...guard, action: z.literal(action) }).strict(),
  ),
  z
    .object({
      ...guard,
      action: z.literal('merge'),
      method: z.enum(['merge', 'squash', 'rebase', 'rebase-merge']),
    })
    .strict(),
  z
    .object({
      ...guard,
      action: z.literal('enable-auto-merge'),
      method: z.enum(['merge', 'squash', 'rebase', 'rebase-merge']),
    })
    .strict(),
  z
    .object({ ...guard, action: z.literal('comment'), body: commentBody, position: position.optional() })
    .strict(),
  z
    .object({
      ...guard,
      action: z.literal('review'),
      verdict: z.enum(['comment', 'approve', 'request-changes', 'approve-with-suggestions', 'wait', 'reset']),
      body: text,
    })
    .strict()
    .refine(
      (v) => !['comment', 'request-changes'].includes(v.verdict) || !!v.body.trim(),
      'Enter review feedback',
    ),
  z
    .object({
      ...guard,
      action: z.literal('reviewer'),
      reviewer: z
        .string()
        .min(1)
        .max(320)
        .refine((v) => noControls(v) && !v.startsWith('-') && !/\s/.test(v)),
      remove: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...guard,
      action: z.literal('reply'),
      threadId: z
        .string()
        .regex(/^[A-Za-z0-9_=-]+$/)
        .max(200),
      body: commentBody,
    })
    .strict(),
  z
    .object({
      ...guard,
      action: z.literal('resolve'),
      threadId: z
        .string()
        .regex(/^[A-Za-z0-9_=-]+$/)
        .max(200),
      resolved: z.boolean(),
    })
    .strict(),
]);
const sourceBranch = z.union([
  branch,
  z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*:[^:]+$/)
    .refine((v) => branch.safeParse(v.slice(v.indexOf(':') + 1)).success),
]);
export const pullRequestCreateSchema = scope
  .extend({
    title: z.string().trim().min(1).max(300),
    body: text,
    sourceBranch,
    targetBranch: branch,
    draft: z.boolean(),
    accountId: z.string().min(1).max(500),
  })
  .strict();
const numberParam = z.object({ number: z.coerce.number().int().positive(), id: z.string().min(1) });

export function registerPullRequestRoutes(app: Hono, service: PullRequestsApplication): void {
  const base = '/api/workspaces/:id/pull-requests';
  app.get(
    `${base}/connections`,
    validate('query', z.object({ root: scope.shape.root }).strict()),
    async (c) => c.json(await service.discover(c.req.param('id'), c.req.valid('query').root)),
  );
  app.get(
    base,
    validate(
      'query',
      scope.extend({ state: z.enum(['open', 'closed', 'merged', 'all']).default('open'), page }).strict(),
    ),
    async (c) => {
      const input = c.req.valid('query');
      return c.json(await service.list(c.req.param('id'), input, input.state, input.page));
    },
  );
  app.post(base, validate('json', pullRequestCreateSchema), async (c) =>
    c.json(await service.create(c.req.param('id'), c.req.valid('json'), c.req.valid('json')), 201),
  );
  app.get(`${base}/:number`, validate('param', numberParam), validate('query', scope.strict()), async (c) =>
    c.json(await service.detail(c.req.param('id'), c.req.valid('query'), c.req.valid('param').number)),
  );
  app.get(
    `${base}/:number/files`,
    validate('param', numberParam),
    validate('query', scope.extend({ head, page }).strict()),
    async (c) => {
      const input = c.req.valid('query');
      return c.json(
        await service.files(c.req.param('id'), input, c.req.valid('param').number, input.head, input.page),
      );
    },
  );
  app.get(
    `${base}/:number/patch`,
    validate('param', numberParam),
    validate('query', scope.extend({ head, path: position.shape.path }).strict()),
    async (c) => {
      const input = c.req.valid('query');
      return c.json(
        await service.patch(c.req.param('id'), input, c.req.valid('param').number, input.head, input.path),
      );
    },
  );
  app.post(
    `${base}/:number/actions`,
    validate('param', numberParam),
    validate('json', pullRequestActionSchema),
    async (c) =>
      c.json(
        await service.action(
          c.req.param('id'),
          c.req.valid('json'),
          c.req.valid('param').number,
          c.req.valid('json'),
        ),
      ),
  );
}
