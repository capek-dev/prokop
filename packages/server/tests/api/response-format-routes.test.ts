import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { createApp } from '@/transport/http/app';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';

interface ResponseFormatResponse {
  formats: unknown[];
  error: string;
  format: {
    id: string;
    name: string;
    description: string;
  };
}

async function json(res: Response): Promise<ResponseFormatResponse> {
  return res.json() as Promise<ResponseFormatResponse>;
}

describe('Response Formats Routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    delete process.env.JEAN2_AUTH_TOKEN;
    setupTestDataDir();
    setupTestDatabase();
    app = createApp();
  });

  afterEach(() => {
    resetTestDatabase();
    resetTestDataDir();
  });

  describe('GET /api/response-formats', () => {
    test('returns list of response formats', async () => {
      const res = await app.request('/api/response-formats');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.formats).toBeInstanceOf(Array);
    });
  });

  describe('GET /api/response-formats/:id', () => {
    test('returns 404 for missing format', async () => {
      const res = await app.request('/api/response-formats/nonexistent');
      expect(res.status).toBe(404);

      const body = await json(res);
      expect(body.error).toBe('not_found');
    });
  });

  describe('POST /api/response-formats', () => {
    test('creates a response format', async () => {
      const res = await app.request('/api/response-formats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Format',
          description: 'A test format',
          schema: {
            type: 'object',
            properties: {
              result: { type: 'string' },
            },
            required: ['result'],
          },
        }),
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.format.name).toBe('Test Format');
      expect(body.format.id).toBeDefined();
      expect(body.format.description).toBe('A test format');
    });

    test('returns 400 when name is missing', async () => {
      const res = await app.request('/api/response-formats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema: { type: 'object' },
        }),
      });

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toBe('bad_request');
    });

    test('returns 400 when schema is missing', async () => {
      const res = await app.request('/api/response-formats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'No Schema',
        }),
      });

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toBe('bad_request');
    });

    test('returns 400 when schema is not an object', async () => {
      const res = await app.request('/api/response-formats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bad Schema',
          schema: 'not-an-object',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/response-formats/:id', () => {
    test('returns 404 for missing format', async () => {
      const res = await app.request('/api/response-formats/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });

    test('updates an existing format', async () => {
      // Create first
      const createRes = await app.request('/api/response-formats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Original',
          schema: { type: 'object' },
        }),
      });
      const created = await json(createRes);
      const id = created.format.id;

      // Update
      const res = await app.request(`/api/response-formats/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.format.name).toBe('Updated Name');
    });
  });

  describe('DELETE /api/response-formats/:id', () => {
    test('returns 404 for missing format', async () => {
      const res = await app.request('/api/response-formats/nonexistent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    test('deletes an existing format', async () => {
      // Create first
      const createRes = await app.request('/api/response-formats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'To Delete',
          schema: { type: 'object' },
        }),
      });
      const created = await json(createRes);
      const id = created.format.id;

      // Delete
      const deleteRes = await app.request(`/api/response-formats/${id}`, {
        method: 'DELETE',
      });
      expect(deleteRes.status).toBe(200);

      // Verify gone
      const getRes = await app.request(`/api/response-formats/${id}`);
      expect(getRes.status).toBe(404);
    });
  });
});
