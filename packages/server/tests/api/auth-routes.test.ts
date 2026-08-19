import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { createApp } from '@/transport/http/app';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';
import { seedWorkspace, seedSession } from '#tests/seed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

const VALID_TOKEN = 'test-secret-token-for-api-tests-12345';

describe('API Auth Middleware', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    setupTestDataDir();
    setupTestDatabase();
  });

  afterEach(() => {
    resetTestDatabase();
    resetTestDataDir();
    delete process.env.JEAN2_AUTH_TOKEN;
  });

  // ── Public Routes (always accessible) ──────────────────────────

  describe('Public routes (no auth required in either state)', () => {
    test('GET / returns 200 without token when auth disabled', async () => {
      delete process.env.JEAN2_AUTH_TOKEN;
      app = createApp();

      const res = await app.request('/');
      expect(res.status).toBe(200);
    });

    test('GET / returns 200 without token when auth enabled', async () => {
      process.env.JEAN2_AUTH_TOKEN = VALID_TOKEN;
      app = createApp();

      const res = await app.request('/');
      expect(res.status).toBe(200);
    });

    test('GET /api/health returns 200 without token when auth disabled', async () => {
      delete process.env.JEAN2_AUTH_TOKEN;
      app = createApp();

      const res = await app.request('/api/health');
      expect(res.status).toBe(200);
    });

    test('GET /api/health returns 200 without token when auth enabled', async () => {
      process.env.JEAN2_AUTH_TOKEN = VALID_TOKEN;
      app = createApp();

      const res = await app.request('/api/health');
      expect(res.status).toBe(200);
    });

    test('GET /api/info returns 200 without token when auth disabled', async () => {
      delete process.env.JEAN2_AUTH_TOKEN;
      app = createApp();

      const res = await app.request('/api/info');
      expect(res.status).toBe(200);
    });

    test('GET /api/info returns 200 without token when auth enabled', async () => {
      process.env.JEAN2_AUTH_TOKEN = VALID_TOKEN;
      app = createApp();

      const res = await app.request('/api/info');
      expect(res.status).toBe(200);
    });
  });

  // ── Protected Routes with Auth Disabled ────────────────────────

  describe('Protected routes — auth disabled', () => {
    beforeEach(() => {
      delete process.env.JEAN2_AUTH_TOKEN;
      app = createApp();
    });

    test('GET /api/sessions returns 200 without token', async () => {
      const res = await app.request('/api/sessions');
      expect(res.status).toBe(200);
    });

    test('GET /api/workspaces returns 200 without token', async () => {
      const res = await app.request('/api/workspaces');
      expect(res.status).toBe(200);
    });

    test('GET /api/tools returns 200 without token', async () => {
      const res = await app.request('/api/tools');
      expect(res.status).toBe(200);
    });

    test('GET /api/models returns 200 without token', async () => {
      const res = await app.request('/api/models');
      expect(res.status).toBe(200);
    });

    test('GET /api/config/providers returns 200 without token', async () => {
      const res = await app.request('/api/config/providers');
      expect(res.status).toBe(200);
    });
  });

  // ── Protected Routes with Auth Enabled — No Token ──────────────

  describe('Protected routes — auth enabled, no token', () => {
    beforeEach(() => {
      process.env.JEAN2_AUTH_TOKEN = VALID_TOKEN;
      app = createApp();
    });

    test('GET /api/sessions returns 401 without token', async () => {
      const res = await app.request('/api/sessions');
      expect(res.status).toBe(401);

      const body = await json(res);
      expect(body.error).toBe('Unauthorized');
      expect(body.message).toContain('Invalid or missing API token');
      expect(body.hint).toContain('Bearer');
    });

    test('GET /api/workspaces returns 401 without token', async () => {
      const res = await app.request('/api/workspaces');
      expect(res.status).toBe(401);
    });

    test('GET /api/tools returns 401 without token', async () => {
      const res = await app.request('/api/tools');
      expect(res.status).toBe(401);
    });

    test('GET /api/models returns 401 without token', async () => {
      const res = await app.request('/api/models');
      expect(res.status).toBe(401);
    });

    test('GET /api/config/providers returns 401 without token', async () => {
      const res = await app.request('/api/config/providers');
      expect(res.status).toBe(401);
    });

    test('GET /api/providers returns 401 without token', async () => {
      const res = await app.request('/api/providers');
      expect(res.status).toBe(401);
    });

    test('GET /api/prompts returns 401 without token', async () => {
      const res = await app.request('/api/prompts');
      expect(res.status).toBe(401);
    });

    test('POST /api/sessions returns 401 without token', async () => {
      const res = await app.request('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test' }),
      });
      expect(res.status).toBe(401);
    });

    test('PUT /api/sessions/s1 returns 401 without token', async () => {
      const res = await app.request('/api/sessions/s1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test' }),
      });
      expect(res.status).toBe(401);
    });

    test('DELETE /api/sessions/s1 returns 401 without token', async () => {
      const res = await app.request('/api/sessions/s1', { method: 'DELETE' });
      expect(res.status).toBe(401);
    });

    test('GET /api/config/models returns 401 without token', async () => {
      const res = await app.request('/api/config/models');
      expect(res.status).toBe(401);
    });

    test('GET /api/fs/browse returns 401 without token', async () => {
      const res = await app.request('/api/fs/browse?path=/tmp');
      expect(res.status).toBe(401);
    });

    test('GET /api/fs/drives returns 401 without token', async () => {
      const res = await app.request('/api/fs/drives');
      expect(res.status).toBe(401);
    });
  });

  // ── Protected Routes with Auth Enabled — Invalid Token ─────────

  describe('Protected routes — auth enabled, invalid token', () => {
    beforeEach(() => {
      process.env.JEAN2_AUTH_TOKEN = VALID_TOKEN;
      app = createApp();
    });

    test('GET /api/sessions returns 401 with wrong Bearer token', async () => {
      const res = await app.request('/api/sessions', {
        headers: { Authorization: 'Bearer wrong-token-value' },
      });
      expect(res.status).toBe(401);

      const body = await json(res);
      expect(body.error).toBe('Unauthorized');
    });

    test('GET /api/sessions returns 401 with malformed Authorization header', async () => {
      const res = await app.request('/api/sessions', {
        headers: { Authorization: 'Basic abc123' },
      });
      expect(res.status).toBe(401);
    });

    test('GET /api/sessions returns 401 with empty Bearer', async () => {
      const res = await app.request('/api/sessions', {
        headers: { Authorization: 'Bearer ' },
      });
      expect(res.status).toBe(401);
    });

    test('GET /api/sessions returns 401 with wrong query param token', async () => {
      const res = await app.request('/api/sessions?token=wrong-token');
      expect(res.status).toBe(401);
    });
  });

  // ── Protected Routes with Auth Enabled — Valid Token via Header ─

  describe('Protected routes — auth enabled, valid Bearer token', () => {
    beforeEach(() => {
      process.env.JEAN2_AUTH_TOKEN = VALID_TOKEN;
      app = createApp();
    });

    test('GET /api/sessions returns 200 with valid Bearer token', async () => {
      const res = await app.request('/api/sessions', {
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(res.status).toBe(200);
    });

    test('GET /api/workspaces returns 200 with valid Bearer token', async () => {
      const res = await app.request('/api/workspaces', {
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(res.status).toBe(200);
    });

    test('GET /api/tools returns 200 with valid Bearer token', async () => {
      const res = await app.request('/api/tools', {
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(res.status).toBe(200);
    });

    test('GET /api/models returns 200 with valid Bearer token', async () => {
      const res = await app.request('/api/models', {
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(res.status).toBe(200);
    });

    test('POST /api/sessions creates session with valid Bearer token', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VALID_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'Authed Session', workspaceId: 'ws1' }),
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.session.title).toBe('Authed Session');
    });

    test('GET /api/config/providers returns 200 with valid Bearer token', async () => {
      const res = await app.request('/api/config/providers', {
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(res.status).toBe(200);
    });

    test('GET /api/config/models returns 200 with valid Bearer token', async () => {
      const res = await app.request('/api/config/models', {
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(res.status).toBe(200);
    });

    test('GET /api/providers returns 200 with valid Bearer token', async () => {
      const res = await app.request('/api/providers', {
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(res.status).toBe(200);
    });

    test('GET /api/prompts returns 200 with valid Bearer token', async () => {
      const res = await app.request('/api/prompts', {
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(res.status).toBe(200);
    });

    test('GET /api/preconfigs returns 200 with valid Bearer token', async () => {
      const res = await app.request('/api/preconfigs', {
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(res.status).toBe(200);
    });

    test('GET /api/fs/browse returns 200 with valid Bearer token', async () => {
      const res = await app.request('/api/fs/browse?path=/tmp', {
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(res.status).toBe(200);
    });

    test('GET /api/fs/drives returns 200 with valid Bearer token', async () => {
      const res = await app.request('/api/fs/drives', {
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(res.status).toBe(200);
    });
  });

  // ── Protected Routes with Auth Enabled — Valid Token via Query ──

  describe('Protected routes — auth enabled, valid token via query param', () => {
    beforeEach(() => {
      process.env.JEAN2_AUTH_TOKEN = VALID_TOKEN;
      app = createApp();
    });

    test('GET /api/sessions returns 200 with valid ?token= param', async () => {
      const res = await app.request(`/api/sessions?token=${VALID_TOKEN}`);
      expect(res.status).toBe(200);
    });

    test('GET /api/workspaces returns 200 with valid ?token= param', async () => {
      const res = await app.request(`/api/workspaces?token=${VALID_TOKEN}`);
      expect(res.status).toBe(200);
    });

    test('GET /api/tools returns 200 with valid ?token= param', async () => {
      const res = await app.request(`/api/tools?token=${VALID_TOKEN}`);
      expect(res.status).toBe(200);
    });
  });

  // ── Attachment Content — Public Route Pattern ──────────────────

  describe('Attachment content URL — public route pattern', () => {
    test('attachment content path bypasses auth when auth enabled', async () => {
      process.env.JEAN2_AUTH_TOKEN = VALID_TOKEN;
      app = createApp();

      // The attachment content route is public — it uses its own access key
      const res = await app.request('/api/sessions/s1/attachments/att1/content?key=some-key');
      // Will return 404 (no attachment) but NOT 401 (auth bypass)
      expect(res.status).not.toBe(401);
    });

    test('attachment content path works when auth disabled', async () => {
      delete process.env.JEAN2_AUTH_TOKEN;
      app = createApp();

      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1' });

      const res = await app.request('/api/sessions/s1/attachments/att1/content?key=some-key');
      // Returns 404 for unknown key, not 401
      expect(res.status).toBe(404);
    });
  });

  // ── WebSocket Endpoint Auth ────────────────────────────────────

  describe('WebSocket endpoint auth', () => {
    test('/ws returns 400 when auth disabled (no upgrade header)', async () => {
      delete process.env.JEAN2_AUTH_TOKEN;
      app = createApp();

      const res = await app.request('/ws');
      // /ws is NOT under /api/* so the auth middleware never runs
      expect(res.status).toBe(400);
    });

    test('/ws returns 400 when auth enabled (no upgrade header)', async () => {
      process.env.JEAN2_AUTH_TOKEN = VALID_TOKEN;
      app = createApp();

      const res = await app.request('/ws');
      // /ws is NOT under /api/* so the auth middleware never runs
      expect(res.status).toBe(400);
    });
  });

  // ── Response Shape Consistency ─────────────────────────────────

  describe('401 response shape', () => {
    beforeEach(() => {
      process.env.JEAN2_AUTH_TOKEN = VALID_TOKEN;
      app = createApp();
    });

    test('all 401 responses have consistent shape', async () => {
      const routes = [
        '/api/sessions',
        '/api/workspaces',
        '/api/tools',
        '/api/models',
        '/api/providers',
        '/api/prompts',
        '/api/preconfigs',
        '/api/config/providers',
        '/api/config/models',
        '/api/fs/browse?path=/tmp',
        '/api/fs/drives',
      ];

      for (const route of routes) {
        const res = await app.request(route);
        expect(res.status).toBe(401);

        const body = await json(res);
        expect(body.error).toBe('Unauthorized');
        expect(body.message).toBe('Invalid or missing API token');
        expect(body.hint).toBeDefined();
        expect(typeof body.hint).toBe('string');
      }
    });
  });
});
