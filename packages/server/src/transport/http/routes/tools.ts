import type { Hono } from 'hono';
import { validate } from './validate';
import type { ToolsHttpApplication } from '@/application/tools';
import { setToolEnvSchema } from './schemas';

/**
 * S4 tool routes. Input validation and wire presentation stay here; every
 * operation invokes the tools application use cases. The route imports no
 * Capek compat entrypoints or configuration modules.
 */
export function registerToolRoutes(app: Hono, application: ToolsHttpApplication): void {
  // GET /api/tools - List all available tools
  app.get('/api/tools', async (c) => {
    const result = await application.listTools();
    return c.json({ tools: result.tools });
  });

  // GET /api/tools/env - List all tool env vars with status
  app.get('/api/tools/env', async (c) => {
    const result = await application.listEnv();
    if (result.kind === 'failed') {
      return c.json({ error: 'Failed to list tool env vars', message: result.message }, 500);
    }
    return c.json(result.status);
  });

  // PUT /api/tools/env/:key - Set a tool env var value
  app.put(
    '/api/tools/env/:key',
    validate('json', setToolEnvSchema),
    async (c) => {
      const key = c.req.param('key');
      const { value } = c.req.valid('json');

      const result = await application.setEnv(key, value);
      if (result.kind === 'invalid') {
        return c.json({ error: 'Bad Request', message: result.message }, 400);
      }
      if (result.kind === 'failed') {
        return c.json({ error: 'Internal Server Error', message: result.message }, 500);
      }
      return c.json({ envVar: result.envVar });
    },
  );

  // DELETE /api/tools/env/:key - Clear a tool env var value
  app.delete('/api/tools/env/:key', async (c) => {
    const key = c.req.param('key');
    const result = await application.clearEnv(key);
    if (result.kind === 'invalid') {
      return c.json({ error: 'Bad Request', message: result.message }, 400);
    }
    if (result.kind === 'failed') {
      return c.json({ error: 'Internal Server Error', message: result.message }, 500);
    }
    return c.json({ envVar: result.envVar });
  });

  // GET /api/tools/:name - Get a specific tool definition
  app.get('/api/tools/:name', async (c) => {
    const name = c.req.param('name');
    const result = await application.getTool(name);
    if (result.kind === 'missing') {
      return c.json({ error: 'not_found', message: 'Tool not found' }, 404);
    }
    return c.json({ tool: result.tool });
  });
}
