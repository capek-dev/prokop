import type { Hono } from 'hono';
import { validate } from './validate';
import { listTools, getTool } from '@capekai/core/compat/jean2';
import * as toolEnv from '@/configuration/tool-env';
import {
  ConfigurationValidationError,
  ConfigurationPersistenceError,
} from '@/configuration/errors';
import { setToolEnvSchema } from './schemas';

export function registerToolRoutes(app: Hono): void {
  // GET /api/tools - List all available tools
  app.get('/api/tools', async (c) => {
    try {
      const tools = await listTools();
      return c.json({ tools });
    } catch (_error) {
      return c.json({ tools: [] });
    }
  });

  // GET /api/tools/env - List all tool env vars with status
  app.get('/api/tools/env', async (c) => {
    try {
      const result = await toolEnv.listToolEnvVars();
      return c.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'Failed to list tool env vars', message }, 500);
    }
  });

  // PUT /api/tools/env/:key - Set a tool env var value
  app.put(
    '/api/tools/env/:key',
    validate('json', setToolEnvSchema),
    async (c) => {
      const key = c.req.param('key');
      const { value } = c.req.valid('json');

      try {
        const result = await toolEnv.setToolEnvVar(key, value.trim());
        return c.json({ envVar: result });
      } catch (err: unknown) {
        if (err instanceof ConfigurationValidationError) {
          return c.json({ error: 'Bad Request', message: err.message }, 400);
        }
        if (err instanceof ConfigurationPersistenceError) {
          return c.json({ error: 'Internal Server Error', message: err.message }, 500);
        }

        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: 'Internal Server Error', message }, 500);
      }
    },
  );

  // GET /api/tools/:name - Get a specific tool definition
  app.get('/api/tools/:name', async (c) => {
    const name = c.req.param('name');
    const tool = await getTool(name);
    if (!tool) {
      return c.json({ error: 'not_found', message: 'Tool not found' }, 404);
    }
    return c.json({ tool });
  });
}
