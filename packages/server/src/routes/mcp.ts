import type { Hono } from 'hono';
import { validate } from './validate';
import type { McpHttpApplication } from '@/application/mcp';
import { NotFoundError } from '@/application/http-errors';
import { mcpServerNameSchema } from './schemas';

/**
 * S5 MCP routes. Input validation and wire presentation stay here; every
 * operation invokes the MCP application use cases. The route imports no
 * store or MCP implementation modules.
 */
export function registerMcpRoutes(app: Hono, application: McpHttpApplication): void {
  app.get('/api/workspaces/:id/mcp/status', async (c) => {
    const workspaceId = c.req.param('id');
    const result = await application.status(workspaceId);
    if (result.kind === 'workspace_not_found') {
      throw new NotFoundError('Workspace not found');
    }
    return c.json({ status: result.status });
  });

  app.post(
    '/api/workspaces/:id/mcp/connect',
    validate('json', mcpServerNameSchema),
    async (c) => {
      const workspaceId = c.req.param('id');
      const { name } = c.req.valid('json');

      const result = await application.connect(workspaceId, name);
      if (result.kind === 'workspace_not_found') {
        throw new NotFoundError('Workspace not found');
      }
      if (result.kind === 'server_not_found') {
        throw new NotFoundError('MCP server not found in config');
      }
      return c.json({ status: result.status });
    },
  );

  app.post(
    '/api/workspaces/:id/mcp/disconnect',
    validate('json', mcpServerNameSchema),
    async (c) => {
      const workspaceId = c.req.param('id');
      const { name } = c.req.valid('json');

      const result = await application.disconnect(workspaceId, name);
      if (result.kind === 'workspace_not_found') {
        throw new NotFoundError('Workspace not found');
      }
      // Preserves the pre-S5 wire shape exactly: the disconnect response
      // carries a `status` property whose value was always undefined, so
      // the JSON body is `{}`.
      return c.json({ status: undefined });
    },
  );

  app.post('/api/workspaces/:id/mcp/restart', async (c) => {
    const workspaceId = c.req.param('id');
    const result = await application.restart(workspaceId);
    if (result.kind === 'workspace_not_found') {
      throw new NotFoundError('Workspace not found');
    }
    return c.json({ status: result.status });
  });
}
