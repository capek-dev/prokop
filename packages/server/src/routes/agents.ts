import { Hono } from 'hono';
import { validate } from './validate';
import type { AgentsApplication } from '@/application/agents';
import { NotFoundError } from '@/utils/http-errors';
import { updateAgentMemorySchema } from './schemas';

/**
 * S4 agent routes. Input validation and wire presentation stay here; every
 * operation invokes the agents application use cases. The route imports no
 * store, filesystem, or configuration modules.
 */
export function registerAgentRoutes(app: Hono, application: AgentsApplication): void {
  app.get('/api/agents', async (c) => {
    const agents = await application.listAgents();
    return c.json({ agents });
  });

  app.get('/api/agents/:id', async (c) => {
    const agent = await application.getAgent(c.req.param('id'));
    if (!agent) throw new NotFoundError('Agent not found');
    return c.json({ agent });
  });

  app.post('/api/agents/:id/promote', async (c) => {
    const agent = await application.promotePreconfig(c.req.param('id'));
    return c.json({ agent });
  });

  app.delete('/api/agents/:id', async (c) => {
    await application.demoteAgent(c.req.param('id'));
    return c.json({ success: true });
  });

  app.get('/api/agents/:id/memory', async (c) => {
    const memory = await application.getAgentMemory(c.req.param('id'));
    return c.json(memory);
  });

  app.patch(
    '/api/agents/:id/memory',
    validate('json', updateAgentMemorySchema),
    async (c) => {
      const { target, content } = c.req.valid('json');
      await application.updateAgentMemory(c.req.param('id'), target, content);
      return c.json({ success: true });
    },
  );
}
