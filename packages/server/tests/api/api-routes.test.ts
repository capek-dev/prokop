import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { createApp } from '@/transport/http/app';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';
import { seedWorkspace, seedSession } from '#tests/seed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

describe('API Routes', () => {
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
    delete process.env.JEAN2_AUTH_TOKEN;
  });

  // ── Health & Info ──────────────────────────────────────────────

  describe('Health & Info', () => {
    test('GET / returns server info', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.status).toBe('ok');
      expect(body.version).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });

    test('GET /api/health returns healthy', async () => {
      const res = await app.request('/api/health');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.status).toBe('healthy');
      expect(body.timestamp).toBeDefined();
    });

    test('GET /api/info returns server capabilities', async () => {
      const res = await app.request('/api/info');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.version).toBeDefined();
      expect(body.runtime).toBe('bun');
      expect(body.features.websocket).toBe(true);
      expect(body.features.sessions).toBe(true);
      expect(body.features.preconfigs).toBe(true);
      expect(body.features.tools).toBe(true);
      expect(body.features.authentication).toBe(false);
    });
  });

  // ── Sessions API ───────────────────────────────────────────────

  describe('Sessions API', () => {
    test('POST /api/sessions creates a session', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test Session', workspaceId: 'ws1' }),
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.session.title).toBe('Test Session');
      expect(body.session.workspaceId).toBe('ws1');
      expect(body.session.id).toBeDefined();
      expect(body.session.status).toBe('active');
    });

    test('POST /api/sessions uses provided id', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'custom-id-123', workspaceId: 'ws1' }),
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.session.id).toBe('custom-id-123');
    });

    test('POST /api/sessions defaults title to "New Session"', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'ws1' }),
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.session.title).toBe('New Session');
    });

    test('GET /api/sessions lists sessions', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1', title: 'A' });
      seedSession('ws1', { id: 's2', title: 'B' });

      const res = await app.request('/api/sessions');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.sessions).toBeInstanceOf(Array);
      expect(body.sessions).toHaveLength(2);
    });

    test('GET /api/sessions filters by status', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1', title: 'Active', status: 'active' });
      seedSession('ws1', { id: 's2', title: 'Closed', status: 'closed' });

      const res = await app.request('/api/sessions?status=active');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].id).toBe('s1');
    });

    test('GET /api/sessions/:id returns session', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1', title: 'My Session' });

      const res = await app.request('/api/sessions/s1');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.session.id).toBe('s1');
      expect(body.session.title).toBe('My Session');
    });

    test('GET /api/sessions/:id returns 404 for missing', async () => {
      const res = await app.request('/api/sessions/nonexistent');
      expect(res.status).toBe(404);

      const body = await json(res);
      expect(body.error).toBe('not_found');
    });

    test('PUT /api/sessions/:id updates title', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1', title: 'Original' });

      const res = await app.request('/api/sessions/s1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.session.title).toBe('Updated');
    });

    test('PUT /api/sessions/:id updates status', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1', title: 'Test' });

      const res = await app.request('/api/sessions/s1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.session.status).toBe('closed');
    });

    test('PUT /api/sessions/:id returns 404 for missing', async () => {
      const res = await app.request('/api/sessions/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'X' }),
      });

      expect(res.status).toBe(404);
    });

    test('DELETE /api/sessions/:id deletes session', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1', title: 'Delete Me' });

      const deleteRes = await app.request('/api/sessions/s1', { method: 'DELETE' });
      expect(deleteRes.status).toBe(200);

      const body = await json(deleteRes);
      expect(body.success).toBe(true);

      const getRes = await app.request('/api/sessions/s1');
      expect(getRes.status).toBe(404);
    });

    test('DELETE /api/sessions/:id returns 404 for missing', async () => {
      const res = await app.request('/api/sessions/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    test('GET /api/sessions/grouped requires workspaceIds', async () => {
      const res = await app.request('/api/sessions/grouped');
      expect(res.status).toBe(400);

      const body = await json(res);
      expect(body.error).toBe('bad_request');
    });

    test('GET /api/sessions/grouped returns grouped sessions', async () => {
      seedWorkspace({ id: 'ws1' });
      seedWorkspace({ id: 'ws2' });
      seedSession('ws1', { id: 's1', title: 'A' });
      seedSession('ws2', { id: 's2', title: 'B' });
      seedSession('ws2', { id: 's3', title: 'C' });

      const res = await app.request('/api/sessions/grouped?workspaceIds=ws1,ws2');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.sessions['ws1']).toHaveLength(1);
      expect(body.sessions['ws2']).toHaveLength(2);
    });

    test('GET /api/sessions/grouped with empty workspaceIds returns 400', async () => {
      const res = await app.request('/api/sessions/grouped?workspaceIds=');
      expect(res.status).toBe(400);

      const body = await json(res);
      // Empty workspaceIds param triggers either validation message
      expect(body.error).toBe('bad_request');
    });
  });

  // ── Workspaces API ─────────────────────────────────────────────

  describe('Workspaces API', () => {
    test('GET /api/workspaces auto-creates default if none exist', async () => {
      const res = await app.request('/api/workspaces');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.workspaces.length).toBeGreaterThanOrEqual(1);
      expect(body.workspaces[0].name).toBe('Virtual Workspace');
      expect(body.workspaces[0].isVirtual).toBe(true);
    });

    test('GET /api/workspaces returns existing workspaces', async () => {
      seedWorkspace({ id: 'ws1', name: 'First' });
      seedWorkspace({ id: 'ws2', name: 'Second' });

      const res = await app.request('/api/workspaces');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.workspaces).toHaveLength(2);
    });

    test('POST /api/workspaces creates workspace', async () => {
      const res = await app.request('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test WS', path: '/tmp/test-ws-api-routes' }),
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.workspace.name).toBe('Test WS');
      expect(body.workspace.id).toBeDefined();
    });

    test('POST /api/workspaces requires path for physical workspace', async () => {
      const res = await app.request('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Path' }),
      });

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.message).toContain('Path is required');
    });

    test('POST /api/workspaces auto-generates path for virtual workspace', async () => {
      const res = await app.request('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Virtual', isVirtual: true }),
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.workspace.path).toBeDefined();
    });

    test('GET /api/workspaces/:id returns workspace', async () => {
      seedWorkspace({ id: 'ws1', name: 'My Workspace' });

      const res = await app.request('/api/workspaces/ws1');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.workspace.id).toBe('ws1');
      expect(body.workspace.name).toBe('My Workspace');
    });

    test('GET /api/workspaces/:id returns 404 for missing', async () => {
      const res = await app.request('/api/workspaces/nonexistent');
      expect(res.status).toBe(404);
    });

    test('PATCH /api/workspaces/:id updates name', async () => {
      seedWorkspace({ id: 'ws1', name: 'Original' });

      const res = await app.request('/api/workspaces/ws1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.workspace.name).toBe('Updated');
    });

    test('PATCH /api/workspaces/:id requires name', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    test('PATCH /api/workspaces/:id updates settings', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: { memory: { enabled: true, permissionRisk: 'medium' } },
        }),
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.workspace.settings.memory.enabled).toBe(true);
      expect(body.workspace.settings.memory.permissionRisk).toBe('medium');
    });

    test('PATCH /api/workspaces/:id validates settings shape', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: 'not-an-object' }),
      });

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toBe('bad_request');
    });

    test('PATCH /api/workspaces/:id validates memory.enabled is boolean', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: { memory: { enabled: 'yes', permissionRisk: 'medium' } },
        }),
      });

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toBe('bad_request');
    });

    test('PATCH /api/workspaces/:id validates memory.permissionRisk enum', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: { memory: { enabled: true, permissionRisk: 'invalid' } },
        }),
      });

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toBe('bad_request');
    });

    test('PATCH /api/workspaces/:id accepts all valid risk levels', async () => {
      seedWorkspace({ id: 'ws1' });

      for (const risk of ['none', 'low', 'medium', 'high', 'critical']) {
        const res = await app.request('/api/workspaces/ws1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settings: { memory: { enabled: true, permissionRisk: risk } },
          }),
        });

        expect(res.status).toBe(200);
        const body = await json(res);
        expect(body.workspace.settings.memory.permissionRisk).toBe(risk);
      }
    });

    test('PATCH /api/workspaces/:id returns 404 for missing', async () => {
      const res = await app.request('/api/workspaces/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      });

      expect(res.status).toBe(404);
    });

    test('DELETE /api/workspaces/:id deletes workspace and returns deleted session IDs', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1', title: 'A' });
      seedSession('ws1', { id: 's2', title: 'B' });

      const res = await app.request('/api/workspaces/ws1', { method: 'DELETE' });
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.success).toBe(true);
      expect(body.deletedSessions).toHaveLength(2);

      const getRes = await app.request('/api/workspaces/ws1');
      expect(getRes.status).toBe(404);
    });

    test('DELETE /api/workspaces/:id returns 404 for missing', async () => {
      const res = await app.request('/api/workspaces/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    test('GET /api/workspaces/:id/sessions lists sessions for workspace', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1', title: 'A' });
      seedSession('ws1', { id: 's2', title: 'B' });

      const res = await app.request('/api/workspaces/ws1/sessions');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.sessions).toHaveLength(2);
    });

    test('GET /api/workspaces/:id/sessions returns 404 for missing workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/sessions');
      expect(res.status).toBe(404);
    });

    test('GET /api/workspaces/:id/sessions filters by status', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1', title: 'Active', status: 'active' });
      seedSession('ws1', { id: 's2', title: 'Closed', status: 'closed' });

      const res = await app.request('/api/workspaces/ws1/sessions?status=active');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].id).toBe('s1');
    });
  });

  // ── Messages API ───────────────────────────────────────────────

  describe('Messages API', () => {
    test('GET /api/sessions/:id/messages returns messages for session', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1' });

      const res = await app.request('/api/sessions/s1/messages');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.messages).toBeInstanceOf(Array);
    });

    test('GET /api/sessions/:id/messages returns 404 for missing session', async () => {
      const res = await app.request('/api/sessions/nonexistent/messages');
      expect(res.status).toBe(404);
    });
  });

  // ── Attachments API ────────────────────────────────────────────

  describe('Attachments API', () => {
    test('GET /api/sessions/:id/attachments returns empty for session with no attachments', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1' });

      const res = await app.request('/api/sessions/s1/attachments');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.attachments).toBeInstanceOf(Array);
      expect(body.attachments).toHaveLength(0);
    });

    test('GET /api/sessions/:id/attachments returns 404 for missing session', async () => {
      const res = await app.request('/api/sessions/nonexistent/attachments');
      expect(res.status).toBe(404);
    });

    test('POST /api/sessions/:id/attachments returns 404 for missing session', async () => {
      const res = await app.request('/api/sessions/nonexistent/attachments', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });

    test('POST /api/sessions/:id/attachments returns error without valid form data', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1' });

      // Sending malformed multipart triggers formData parse error -> 500 via app.onError
      const res = await app.request('/api/sessions/s1/attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // Hono's formData() throws on invalid MIME type/boundary
      expect(res.status).toBe(500);
    });

    test('GET /api/sessions/:id/attachments/:attId/content returns 401 without access key', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1' });

      const res = await app.request('/api/sessions/s1/attachments/att1/content');
      expect(res.status).toBe(401);
    });

    test('GET /api/sessions/:id/attachments/:attId/content returns 404 with invalid key', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1' });

      const res = await app.request('/api/sessions/s1/attachments/att1/content?key=invalid');
      expect(res.status).toBe(404);
    });
  });

  // ── Tools API ──────────────────────────────────────────────────

  describe('Tools API', () => {
    test('GET /api/tools returns tools list', async () => {
      const res = await app.request('/api/tools');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.tools).toBeDefined();
    });

    test('GET /api/tools/:name returns 404 for missing tool', async () => {
      const res = await app.request('/api/tools/nonexistent-tool');
      expect(res.status).toBe(404);
    });
  });

  // ── Preconfigs API ─────────────────────────────────────────────

  describe('Preconfigs API', () => {
    test('GET /api/preconfigs returns preconfig list', async () => {
      const res = await app.request('/api/preconfigs');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.preconfigs).toBeInstanceOf(Array);
    });

    test('GET /api/preconfigs/:id returns 404 for missing', async () => {
      const res = await app.request('/api/preconfigs/nonexistent');
      expect(res.status).toBe(404);
    });

    test('POST /api/preconfigs creates a preconfig', async () => {
      const res = await app.request('/api/preconfigs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Preconfig',
          systemPrompt: 'You are a test assistant.',
        }),
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.preconfig.name).toBe('Test Preconfig');
    });

    test('DELETE /api/preconfigs/:id returns 404 for missing', async () => {
      const res = await app.request('/api/preconfigs/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  // ── Prompts API ────────────────────────────────────────────────

  describe('Prompts API', () => {
    test('GET /api/prompts returns prompts list', async () => {
      const res = await app.request('/api/prompts');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.prompts).toBeInstanceOf(Array);
    });
  });

  // ── Models API ─────────────────────────────────────────────────

  describe('Models API', () => {
    test('GET /api/models returns model list', async () => {
      const res = await app.request('/api/models');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.models).toBeDefined();
    });
  });

  // ── Providers API ──────────────────────────────────────────────

  describe('Providers API', () => {
    test('GET /api/providers returns providers list', async () => {
      const res = await app.request('/api/providers');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.providers).toBeInstanceOf(Array);
    });

    test('GET /api/providers/:providerId/status returns status for unknown provider', async () => {
      const res = await app.request('/api/providers/nonexistent/status');
      // Provider status returns 200 with a status object even for unknown providers
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.status).toBeDefined();
    });

    test('DELETE /api/providers/:providerId returns 500 for unknown provider', async () => {
      const res = await app.request('/api/providers/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(500);
    });
  });

  // ── Config: Provider Credentials ───────────────────────────────

  describe('Config: Provider Credentials', () => {
    test('GET /api/config/providers returns credentials', async () => {
      const res = await app.request('/api/config/providers');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.providers).toBeInstanceOf(Array);
    });
  });

  // ── Config: Models ─────────────────────────────────────────────

  describe('Config: Models', () => {
    test('GET /api/config/models returns models config', async () => {
      const res = await app.request('/api/config/models');
      expect(res.status).toBe(200);
    });
  });

  // ── Filesystem Browse API ──────────────────────────────────────

  describe('Filesystem Browse API', () => {
    test('GET /api/fs/browse lists files', async () => {
      const res = await app.request('/api/fs/browse?path=/tmp');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.files).toBeDefined();
      expect(body.mode).toBe('browse');
    });

    test('GET /api/fs/browse returns 400 for invalid path', async () => {
      const res = await app.request('/api/fs/browse?path=/nonexistent/path/that/does/not/exist');
      expect(res.status).toBe(400);
    });

    test('GET /api/fs/parent returns parent directory', async () => {
      const res = await app.request('/api/fs/parent?path=/tmp');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.files).toBeDefined();
      expect(body.mode).toBe('browse');
    });

    test('GET /api/fs/drives returns drives list', async () => {
      const res = await app.request('/api/fs/drives');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.drives).toBeInstanceOf(Array);
      expect(body.drives.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Workspace Files API ────────────────────────────────────────

  describe('Workspace Files API', () => {
    test('GET /api/workspaces/:id/files returns 404 for missing workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/files');
      expect(res.status).toBe(404);
    });

    test('GET /api/workspaces/:id/file-preview returns 400 without path', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/file-preview');
      expect(res.status).toBe(400);
    });

    test('GET /api/workspaces/:id/file-preview returns 404 for missing workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/file-preview?path=test.txt');
      expect(res.status).toBe(404);
    });
  });

  // ── MCP API ────────────────────────────────────────────────────

  describe('MCP API', () => {
    test('GET /api/workspaces/:id/mcp/status returns 404 for missing workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/mcp/status');
      expect(res.status).toBe(404);
    });

    test('POST /api/workspaces/:id/mcp/connect returns 404 for missing workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/mcp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-server' }),
      });
      expect(res.status).toBe(404);
    });

    test('POST /api/workspaces/:id/mcp/connect returns 400 without name', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/workspaces/ws1/mcp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    test('POST /api/workspaces/:id/mcp/disconnect returns 404 for missing workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/mcp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });
      expect(res.status).toBe(404);
    });

    test('POST /api/workspaces/:id/mcp/auth returns 404 for missing workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/mcp/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });
      expect(res.status).toBe(404);
    });

    test('POST /api/workspaces/:id/mcp/auth/callback returns 404 for missing workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/mcp/auth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', code: 'abc' }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── Terminal Sessions API ──────────────────────────────────────

  describe('Terminal Sessions API', () => {
    test('GET /api/workspaces/:id/terminals returns 404 for missing workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/terminals');
      expect(res.status).toBe(404);
    });

    test('POST /api/workspaces/:id/terminals returns 404 for missing workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/terminals', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });
  });

  // ── WebSocket Endpoint ─────────────────────────────────────────

  describe('WebSocket endpoint', () => {
    test('GET /ws returns 400 when not upgraded', async () => {
      // Without the 'upgrade' header, the handler returns 400
      const res = await app.request('/ws');
      expect(res.status).toBe(400);

      const body = await json(res);
      expect(body.message).toContain('WebSocket upgrade');
    });
  });

  // ── 404 Handler ────────────────────────────────────────────────

  describe('404 handler', () => {
    test('returns JSON 404 for unknown routes', async () => {
      const res = await app.request('/api/unknown-route');
      expect(res.status).toBe(404);

      const body = await json(res);
      expect(body.error).toBe('Not Found');
      expect(body.path).toBe('/api/unknown-route');
      expect(body.method).toBe('GET');
    });

    test('returns JSON 404 for unknown non-API routes', async () => {
      const res = await app.request('/random/path');
      expect(res.status).toBe(404);

      const body = await json(res);
      expect(body.error).toBe('Not Found');
    });
  });

  // ── Error Handler ──────────────────────────────────────────────

  describe('error handler', () => {
    test('malformed JSON body falls through to defaults', async () => {
      seedWorkspace({ id: 'ws1' });

      const res = await app.request('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });

      // Empty body -> workspaceId defaults to '' -> no FK match -> 500
      expect(res.status).toBe(500);

      const body = await json(res);
      expect(body.error).toBe('Internal Server Error');
    });
  });

  // ── Centralized HttpError Handling ─────────────────────────────

  describe('centralized HttpError handling', () => {
    test('NotFoundError returns 404 with code and message', async () => {
      const res = await app.request('/api/sessions/nonexistent');
      expect(res.status).toBe(404);

      const body = await json(res);
      expect(body.error).toBe('not_found');
      expect(body.message).toBe('Session not found');
    });

    test('BadRequestError returns 400 with code and message', async () => {
      const res = await app.request('/api/sessions/grouped');
      expect(res.status).toBe(400);

      const body = await json(res);
      expect(body.error).toBe('bad_request');
      expect(body.message).toContain('workspaceIds');
    });

    test('PinnedMessageError maps to correct status codes', async () => {
      seedWorkspace({ id: 'ws1' });
      seedSession('ws1', { id: 's1' });

      // Pin a non-existent message -> message_not_found -> 404
      const res = await app.request('/api/workspaces/ws1/pinned-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 's1', messageId: 'nonexistent' }),
      });

      expect(res.status).toBe(404);
      const body = await json(res);
      expect(body.error).toBe('message_not_found');
    });

    test('HttpError responses do not include stack traces', async () => {
      const res = await app.request('/api/sessions/nonexistent');
      expect(res.status).toBe(404);

      const body = await json(res);
      expect(body.stack).toBeUndefined();
    });
  });
});
