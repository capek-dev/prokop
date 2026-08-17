import type { Hono } from 'hono';
import { validate } from './validate';
import { randomUUID } from 'crypto';
import type { ResponseFormatsApplication } from '@/application/ports/response-formats';
import { NotFoundError } from '@/utils/http-errors';
import { createResponseFormatSchema, updateResponseFormatSchema } from './schemas';

export function registerResponseFormatRoutes(app: Hono, responseFormats: ResponseFormatsApplication): void {
  app.get('/api/response-formats', async (c) => {
    const formats = responseFormats.list();
    return c.json({ formats });
  });

  app.get('/api/response-formats/:id', async (c) => {
    const id = c.req.param('id');
    const format = responseFormats.get(id);
    if (!format) {
      throw new NotFoundError('Response format not found');
    }
    return c.json({ format });
  });

  app.post(
    '/api/response-formats',
    validate('json', createResponseFormatSchema),
    async (c) => {
      const body = c.req.valid('json');

      const format = responseFormats.create({
        id: randomUUID(),
        name: body.name.trim(),
        description: body.description?.trim() || undefined,
        schema: body.schema as Record<string, unknown>,
      });
      return c.json({ format }, 201);
    },
  );

  app.put(
    '/api/response-formats/:id',
    validate('json', updateResponseFormatSchema),
    async (c) => {
      const id = c.req.param('id');
      const body = c.req.valid('json');

      const updated = responseFormats.update(id, {
        name: body.name?.trim() || undefined,
        description: body.description !== undefined ? body.description?.trim() : undefined,
        schema: body.schema || undefined,
      });
      if (!updated) {
        throw new NotFoundError('Response format not found');
      }
      return c.json({ format: updated });
    },
  );

  app.delete('/api/response-formats/:id', async (c) => {
    const id = c.req.param('id');
    const deleted = responseFormats.delete(id);
    if (!deleted) {
      throw new NotFoundError('Response format not found');
    }
    return c.json({ success: true });
  });
}
