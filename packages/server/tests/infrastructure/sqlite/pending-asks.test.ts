import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import {
  createPendingAsk,
  removePendingAsk,
  removePendingAsksByToolCallId,
  listPendingAsksBySession,
  listPendingAsksByRootSession,
  listAllPendingAsks,
  cleanupAllPendingAsks,
  type PendingAskRecord,
} from '@/infrastructure/sqlite/pending-asks';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { createTestSession } from '#tests/factories';

function makeSession(overrides: { id: string; workspaceId: string; title: string; status: 'active' | 'closed'; parentId?: string }) {
  const { createdAt: _c, updatedAt: _u, ...defaults } = createTestSession(overrides);
  return defaults;
}

describe('pending-asks store', () => {
  let sessionId: string;

  beforeEach(() => {
    setupTestDatabase();
    const result = seedWorkspaceWithSession();
    sessionId = result.sessionId;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function createTestAsk(overrides: Partial<PendingAskRecord> = {}): Omit<PendingAskRecord, 'id'> {
    return {
      sessionId: overrides.sessionId ?? sessionId,
      toolCallId: overrides.toolCallId ?? 'call-1',
      toolName: overrides.toolName ?? 'test-tool',
      ask: overrides.ask ?? { type: 'permission', question: 'Allow?' },
      createdAt: overrides.createdAt ?? Date.now(),
      requestId: overrides.requestId ?? 'req-1',
      status: overrides.status ?? 'pending',
      isPermission: overrides.isPermission ?? true,
    };
  }

  describe('CRUD', () => {
    test('createPendingAsk returns id', () => {
      const id = createPendingAsk(createTestAsk());
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    test('listPendingAsksBySession returns asks', () => {
      createPendingAsk(createTestAsk({ toolCallId: 'call-1' }));
      createPendingAsk(createTestAsk({ toolCallId: 'call-2' }));

      const asks = listPendingAsksBySession(sessionId);
      expect(asks).toHaveLength(2);
    });

    test('listPendingAsksBySession returns empty when none', () => {
      expect(listPendingAsksBySession(sessionId)).toHaveLength(0);
    });

    test('removePendingAsk deletes the ask', () => {
      const id = createPendingAsk(createTestAsk());

      removePendingAsk(id);
      expect(listPendingAsksBySession(sessionId)).toHaveLength(0);
    });

    test('removePendingAsksByToolCallId deletes all asks for a call', () => {
      createPendingAsk(createTestAsk({ toolCallId: 'call-1' }));
      createPendingAsk(createTestAsk({ toolCallId: 'call-1' }));
      createPendingAsk(createTestAsk({ toolCallId: 'call-2' }));

      removePendingAsksByToolCallId('call-1');
      const asks = listPendingAsksBySession(sessionId);
      expect(asks).toHaveLength(1);
      expect(asks[0].toolCallId).toBe('call-2');
    });
  });

  describe('listPendingAsksByRootSession', () => {
    test('returns asks for root session only when no children', () => {
      createPendingAsk(createTestAsk({ toolCallId: 'call-1' }));

      const asks = listPendingAsksByRootSession(sessionId);
      expect(asks).toHaveLength(1);
    });

    test('includes asks from child sessions', () => {
      createPendingAsk(createTestAsk({ toolCallId: 'call-1' }));

      // Create child session with pending ask
      createSession(makeSession({ id: 'child1', workspaceId: 'ws1', title: 'Child', status: 'active', parentId: sessionId }));
      createPendingAsk(createTestAsk({ sessionId: 'child1', toolCallId: 'call-2' }));

      const asks = listPendingAsksByRootSession(sessionId);
      expect(asks).toHaveLength(2);
    });

    test('includes asks from nested child sessions', () => {
      createPendingAsk(createTestAsk({ toolCallId: 'call-1' }));

      createSession(makeSession({ id: 'child1', workspaceId: 'ws1', title: 'Child', status: 'active', parentId: sessionId }));
      createPendingAsk(createTestAsk({ sessionId: 'child1', toolCallId: 'call-2' }));

      createSession(makeSession({ id: 'grandchild1', workspaceId: 'ws1', title: 'Grandchild', status: 'active', parentId: 'child1' }));
      createPendingAsk(createTestAsk({ sessionId: 'grandchild1', toolCallId: 'call-3' }));

      const asks = listPendingAsksByRootSession(sessionId);
      expect(asks).toHaveLength(3);
    });
  });

  describe('listAllPendingAsks', () => {
    test('returns all pending asks across sessions', () => {
      createPendingAsk(createTestAsk({ toolCallId: 'call-1' }));

      createSession(makeSession({ id: 'sess2', workspaceId: 'ws1', title: 'S2', status: 'active' }));
      createPendingAsk(createTestAsk({ sessionId: 'sess2', toolCallId: 'call-2' }));

      expect(listAllPendingAsks()).toHaveLength(2);
    });
  });

  describe('cleanupAllPendingAsks', () => {
    test('hard-deletes all pending asks when no maxAgeMs', () => {
      createPendingAsk(createTestAsk({ toolCallId: 'call-1' }));
      createPendingAsk(createTestAsk({ toolCallId: 'call-2' }));

      const count = cleanupAllPendingAsks();
      expect(count).toBe(2);
      expect(listAllPendingAsks()).toHaveLength(0);
    });

    test('expires old pending asks and deletes old terminal asks', () => {
      const oldTime = Date.now() - 10000;
      const recentTime = Date.now();

      createPendingAsk(createTestAsk({ toolCallId: 'old-pending', createdAt: oldTime }));
      createPendingAsk(createTestAsk({ toolCallId: 'recent-pending', createdAt: recentTime }));

      const count = cleanupAllPendingAsks(5000);
      // Old pending is expired (1) then the just-expired row is also old terminal (deleted: 1)
      expect(count).toBe(2); // 1 expired + 1 deleted (same row)

      const remaining = listPendingAsksBySession(sessionId);
      expect(remaining).toHaveLength(1); // only recent survives (old was expired then deleted)
      expect(remaining[0].toolCallId).toBe('recent-pending');
      expect(remaining[0].status).toBe('pending');
    });

    test('deletes old terminal asks but not recent ones', () => {
      const oldTime = Date.now() - 10000;
      const recentTime = Date.now();

      // Create old approved ask
      createPendingAsk(createTestAsk({ toolCallId: 'old-approved', createdAt: oldTime, status: 'approved' }));
      // Create recent expired ask
      createPendingAsk(createTestAsk({ toolCallId: 'recent-expired', createdAt: recentTime, status: 'expired' }));

      const count = cleanupAllPendingAsks(5000);
      expect(count).toBe(1); // 1 old terminal deleted

      const remaining = listPendingAsksBySession(sessionId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].toolCallId).toBe('recent-expired');
    });
  });
});
