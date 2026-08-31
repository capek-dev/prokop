import type { Hono } from 'hono';
import { validate } from './validate';
import type { SessionStatus } from '@prokopai/sdk';
import type { WorkspaceApplication } from '@/application/workspaces';
import { BadRequestError, NotFoundError } from '@/application/http-errors';
import {
  createTerminalSchema,
  createWorkspaceSchema,
  updateWorkspaceSettingsSchema,
  pinMessageSchema,
} from './schemas';

/**
 * S4 workspace routes. Validation, status mapping, and wire presentation
 * stay here; every operation invokes the workspace application use cases.
 * The route imports no store, filesystem, MCP, terminal, or paths modules.
 */
export function registerWorkspaceRoutes(app: Hono, application: WorkspaceApplication): void {
  // GET /api/workspaces - List all workspaces
  app.get('/api/workspaces', async (c) => {
    const result = application.list();
    if (result.kind === 'mkdir_failed') {
      return c.json(
        { error: 'Internal Server Error', message: 'Failed to create workspace directory' },
        500,
      );
    }
    return c.json({ workspaces: result.workspaces });
  });

  // POST /api/workspaces - Create a new workspace
  app.post(
    '/api/workspaces',
    validate('json', createWorkspaceSchema),
    async (c) => {
      const body = c.req.valid('json');
      const { name, path, isVirtual, additionalPaths } = body;

      const result = application.create({ name, path, isVirtual, additionalPaths });
      if (result.kind === 'path_required') {
        throw new BadRequestError('Path is required for physical workspaces');
      }
      if (result.kind === 'mkdir_failed') {
        throw new BadRequestError('Failed to create workspace directory');
      }
      return c.json({ workspace: result.workspace }, 201);
    },
  );

  app.get('/api/workspaces/:id', async (c) => {
    const id = c.req.param('id');
    const workspace = application.get(id);
    if (!workspace) {
      throw new NotFoundError('Workspace not found');
    }
    return c.json({ workspace });
  });

  // PATCH /api/workspaces/:id - Update a workspace (name, additionalPaths, settings)
  app.patch(
    '/api/workspaces/:id',
    validate('json', updateWorkspaceSettingsSchema),
    async (c) => {
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const { name, additionalPaths, settings } = body;

      const result = application.update(id, {
        name,
        additionalPaths,
        settings: settings as import('@prokopai/sdk').WorkspaceSettings | undefined,
      });
      if (result.kind === 'no_fields') {
        throw new BadRequestError('Name, additionalPaths, or settings is required');
      }
      if (result.kind === 'missing') {
        throw new NotFoundError('Workspace not found');
      }
      return c.json({ workspace: result.workspace });
    },
  );

  // DELETE /api/workspaces/:id - Delete a workspace
  app.delete('/api/workspaces/:id', async (c) => {
    const id = c.req.param('id');
    const result = await application.deleteWorkspace(id);
    if (result.kind === 'missing') {
      throw new NotFoundError('Workspace not found');
    }
    return c.json({ success: true, deletedSessions: result.deletedSessions });
  });

  // GET /api/workspaces/:id/terminals - List active terminal sessions
  app.get('/api/workspaces/:id/terminals', async (c) => {
    const result = application.listTerminals(c.req.param('id'));
    if (result.kind === 'missing') {
      throw new NotFoundError('Workspace not found');
    }
    return c.json({ sessions: result.sessions });
  });

  // POST /api/workspaces/:id/terminals - Create a new terminal session
  app.post('/api/workspaces/:id/terminals', async (c) => {
    const rawBody = await c.req.json().catch(() => ({}));
    const parsedBody = createTerminalSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      throw new BadRequestError('Invalid terminal options');
    }

    const result = application.createTerminal(c.req.param('id'), parsedBody.data.cwd);
    if (result.kind === 'missing') {
      throw new NotFoundError('Workspace not found');
    }
    if (result.kind === 'invalid_path') {
      throw new BadRequestError('Terminal path must be a registered workspace root');
    }
    if (result.kind === 'limit') {
      return c.json(
        { error: 'Limit Reached', message: 'Maximum terminal sessions reached for this workspace' },
        429,
      );
    }
    return c.json({ session: result.session });
  });

  // GET /api/workspaces/:id/terminals/:sessionId - Get single session info
  app.get('/api/workspaces/:id/terminals/:sessionId', async (c) => {
    const session = application.getTerminal(c.req.param('sessionId'));
    if (!session) {
      throw new NotFoundError('Terminal session not found');
    }
    return c.json(session);
  });

  // DELETE /api/workspaces/:id/terminals/:sessionId - Kill and destroy a terminal session
  app.delete('/api/workspaces/:id/terminals/:sessionId', async (c) => {
    application.destroyTerminal(c.req.param('sessionId'));
    return c.json({ success: true });
  });

  // GET /api/workspaces/:id/sessions - List sessions in a workspace
  app.get('/api/workspaces/:id/sessions', async (c) => {
    const workspaceId = c.req.param('id');
    const status = c.req.query('status') as SessionStatus | undefined;
    const rootOnly = c.req.query('rootOnly') === 'true';
    const cursorParam = c.req.query('cursor');
    const limitParam = c.req.query('limit');

    const usePagination = cursorParam !== undefined || limitParam !== undefined;

    if (!usePagination) {
      const result = application.listSessions(workspaceId, { status, rootOnly });
      if (result.kind === 'missing') {
        throw new NotFoundError('Workspace not found');
      }
      return c.json({ sessions: result.sessions });
    }

    const result = application.listSessionPage(workspaceId, {
      status,
      rootOnly,
      cursorParam,
      limitParam,
    });
    if (result.kind === 'missing') {
      throw new NotFoundError('Workspace not found');
    }
    if (result.kind === 'bad_cursor') {
      throw new BadRequestError('Invalid cursor');
    }
    if (result.kind === 'bad_limit') {
      throw new BadRequestError('limit must be an integer between 1 and 100');
    }
    return c.json({
      sessions: result.page.sessions,
      pagination: {
        nextCursor: result.page.nextCursor
          ? application.encodeCursor(result.page.nextCursor)
          : null,
        hasMore: result.page.hasMore,
        limit: result.page.limit,
      },
    });
  });

  // GET /api/workspaces/:id/pinned-messages - List pinned messages for a workspace
  app.get('/api/workspaces/:id/pinned-messages', async (c) => {
    const result = application.listPinned(c.req.param('id'));
    if (result.kind === 'missing') {
      throw new NotFoundError('Workspace not found');
    }
    return c.json({ pinnedMessages: result.pinnedMessages });
  });

  // POST /api/workspaces/:id/pinned-messages - Pin a message
  app.post(
    '/api/workspaces/:id/pinned-messages',
    validate('json', pinMessageSchema),
    async (c) => {
      const workspaceId = c.req.param('id');
      const { sessionId, messageId } = c.req.valid('json');

      const pinnedMessage = application.pin({ workspaceId, sessionId, messageId });
      return c.json({ pinnedMessage }, 201);
    },
  );

  // DELETE /api/workspaces/:id/pinned-messages/:messageId - Unpin a message
  app.delete('/api/workspaces/:id/pinned-messages/:messageId', async (c) => {
    const workspaceId = c.req.param('id');
    const messageId = c.req.param('messageId');

    const result = application.unpin(workspaceId, messageId);
    if (result.kind === 'missing') {
      throw new NotFoundError('Workspace not found');
    }
    return c.json({ success: true });
  });
}
