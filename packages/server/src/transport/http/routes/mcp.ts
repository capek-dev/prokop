import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { validate } from './validate';
import { mcpNameSchema, mcpServerConfigSchema, type McpHttpApplication } from '@/application/mcp';
import { NotFoundError } from '@/application/http-errors';
import { mcpServerNameSchema } from './schemas';

/**
 * S5 MCP routes. Input validation and wire presentation stay here; every
 * operation invokes the MCP application use cases. The route imports no
 * store or MCP implementation modules.
 */
export function registerMcpRoutes(app: Hono, application: McpHttpApplication): void {
  for (const base of ['/api/mcp', '/api/workspaces/:id/mcp']) {
    const scope = (c: Context): string | null => base === '/api/mcp' ? null : c.req.param('id')!;
    app.post(`${base}/servers`, validate('json', z.object({
      name: mcpNameSchema, config: mcpServerConfigSchema,
    }).strict()), async c => {
      const { name, config } = c.req.valid('json');
      await application.save(scope(c), name, config);
      return c.json({ success: true });
    });
    app.post(`${base}/remove`, validate('json', mcpServerNameSchema), async c => {
      await application.remove(scope(c), c.req.valid('json').name);
      return c.json({ success: true });
    });
    app.get(`${base}/tools`, validate('query', z.object({ name: mcpNameSchema })), async c => {
      return c.json({ tools: await application.tools(scope(c), c.req.valid('query').name) });
    });
    app.post(`${base}/tools`, validate('json', z.object({
      name: mcpNameSchema, toolName: z.string().min(1).max(256), enabled: z.boolean(),
    }).strict()), async c => {
      const { name, toolName, enabled } = c.req.valid('json');
      await application.setToolEnabled(scope(c), name, toolName, enabled);
      return c.json({ success: true });
    });
    app.post(`${base}/auth`, validate('json', mcpServerNameSchema), async c => {
      const redirectUrl = new URL('/api/mcp/oauth/callback', c.req.url).toString();
      return c.json(await application.startAuth(scope(c), c.req.valid('json').name, redirectUrl));
    });
    app.post(`${base}/auth/callback`, validate('json', z.object({
      name: mcpNameSchema, state: z.string().uuid(), code: z.string().min(1).max(8192),
    }).strict()), async c => {
      const { name, state, code } = c.req.valid('json');
      return c.json(await application.finishWorkspaceAuth(scope(c), name, state, code));
    });
    app.get(`${base}/status`, async (c) => {
      const workspaceId = scope(c);
      const result = await application.status(workspaceId);
      if (result.kind === 'workspace_not_found') {
        throw new NotFoundError('Workspace not found');
      }
      return c.json({ status: result.status });
    });

    app.post(
      `${base}/connect`,
      validate('json', mcpServerNameSchema),
      async (c) => {
        const workspaceId = scope(c);
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
      `${base}/disconnect`,
      validate('json', mcpServerNameSchema),
      async (c) => {
        const workspaceId = scope(c);
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

    app.post(`${base}/restart`, async (c) => {
      const workspaceId = scope(c);
      const result = await application.restart(workspaceId);
      if (result.kind === 'workspace_not_found') {
        throw new NotFoundError('Workspace not found');
      }
      return c.json({ status: result.status });
    });
  }
  // This browser redirect is authenticated by expiring, single-use OAuth state.
  app.get('/api/mcp/oauth/callback', validate('query', z.object({
    state: z.string().uuid(), code: z.string().min(1).max(8192),
  })), async c => {
    const { state, code } = c.req.valid('query');
    const result = await application.finishAuth(state, code);
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    return c.html('<!doctype html><title>MCP sign-in</title><p>' +
      (result.status.status === 'connected' ? 'Connected. You can close this tab and return to Prokop.'
        : 'Sign-in completed, but the connection failed. Return to MCP settings to reconnect.') + '</p>');
  });
}
