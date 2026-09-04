import type { Hono } from 'hono';
import { z } from 'zod';
import type { WorktreeApplication, WorktreeFailureCode } from '@/application/worktrees';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '@/application/http-errors';
import { validate } from './validate';

const createWorktreeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  branch: z.string().startsWith('refs/heads/'),
}).strict();

const bindWorktreeSchema = z.object({
  worktreeId: z.string().min(1),
}).strict();

function throwFailure(code: WorktreeFailureCode, message: string): never {
  if (code === 'workspace_not_found' || code === 'worktree_not_found' || code === 'session_not_found') {
    throw new NotFoundError(message);
  }
  if (
    code === 'git_error'
    || code === 'git_not_installed'
    || code === 'not_a_git_repository'
    || code === 'invalid_branch_name'
    || code === 'invalid_worktree_name'
    || code === 'branch_not_found'
    || code === 'repository_outside_workspace'
    || code === 'operation_timed_out'
    || code === 'output_limit'
  ) {
    throw new BadRequestError(message, { code });
  }
  throw new ConflictError(message, { code });
}

export function registerWorktreeRoutes(app: Hono, application: WorktreeApplication): void {
  app.get('/api/workspaces/:id/worktrees', async (c) => {
    const result = await application.list(c.req.param('id'));
    if (!result.ok) throwFailure(result.code, result.message);
    return c.json({ worktrees: result.value });
  });

  app.get('/api/workspaces/:id/worktree-refs', async (c) => {
    const result = await application.listRefs(c.req.param('id'));
    if (!result.ok) throwFailure(result.code, result.message);
    return c.json({ refs: result.value });
  });

  app.post(
    '/api/workspaces/:id/worktrees',
    validate('json', createWorktreeSchema),
    async (c) => {
      const result = await application.create(c.req.param('id'), c.req.valid('json'));
      if (!result.ok) throwFailure(result.code, result.message);
      return c.json({ worktree: result.value }, 201);
    },
  );

  app.delete('/api/workspaces/:id/worktrees/:worktreeId', async (c) => {
    const result = await application.remove(
      c.req.param('id'),
      c.req.param('worktreeId'),
    );
    if (!result.ok) throwFailure(result.code, result.message);
    return c.json({ worktree: result.value });
  });

  app.put(
    '/api/sessions/:id/worktree',
    validate('json', bindWorktreeSchema),
    async (c) => {
      const result = await application.bind(
        c.req.param('id'),
        c.req.valid('json').worktreeId,
      );
      if (!result.ok) throwFailure(result.code, result.message);
      return c.json({ session: result.value });
    },
  );

  app.delete('/api/sessions/:id/worktree', async (c) => {
    const result = await application.unbind(c.req.param('id'));
    if (!result.ok) throwFailure(result.code, result.message);
    return c.json({ session: result.value });
  });
}
