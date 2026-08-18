import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { createApp } from '@/app';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';
import { seedWorkspace, seedSession } from '#tests/seed';
import { createMessage } from '@/infrastructure/sqlite/message-store';
import { createTestUserMessage } from '#tests/factories';

interface MaintenanceResponse {
  pageCountBefore: number;
  pageSizeBefore: number;
  reclaimedBytes: number;
  success: boolean;
  stats: {
    orphanedMessages: number;
  };
  pageSizeAfter: number;
}

async function json(res: Response): Promise<MaintenanceResponse> {
  return res.json() as Promise<MaintenanceResponse>;
}

describe('Maintenance Routes', () => {
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

  describe('GET /api/maintenance/db-stats', () => {
    test('returns database statistics', async () => {
      const res = await app.request('/api/maintenance/db-stats');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.pageCountBefore).toBeGreaterThan(0);
      expect(body.pageSizeBefore).toBeGreaterThan(0);
      expect(body.reclaimedBytes).toBeGreaterThanOrEqual(0);
    });
  });

  describe('POST /api/maintenance/cleanup', () => {
    test('removes orphaned data and returns stats', async () => {
      const res = await app.request('/api/maintenance/cleanup', { method: 'POST' });
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.success).toBe(true);
      expect(body.stats).toBeDefined();
      expect(body.stats.orphanedMessages).toBe(0);
    });
  });

  describe('POST /api/maintenance/vacuum', () => {
    test('reclaims space and returns before/after stats', async () => {
      // Create some data to make the vacuum meaningful
      const { sessionId } = (() => {
        seedWorkspace({ id: 'ws1' });
        const s = seedSession('ws1');
        return { sessionId: s.id };
      })();

      createMessage(createTestUserMessage(sessionId));

      const res = await app.request('/api/maintenance/vacuum', { method: 'POST' });
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.success).toBe(true);
      expect(body.reclaimedBytes).toBeGreaterThanOrEqual(0);
      expect(body.pageSizeAfter).toBeGreaterThan(0);
    });
  });
});
