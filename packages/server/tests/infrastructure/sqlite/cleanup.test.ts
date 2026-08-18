import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { createTestUserMessage, createTestAssistantMessage, createTestTextPart, createTestSession } from '#tests/factories';
import {
  createSession,
  deleteSession,
  deleteSessionsByWorkspace,
  getSession,
} from '@/infrastructure/sqlite/session-store';
import {
  createMessage,
  createPart,
  listMessagesWithParts,
} from '@/infrastructure/sqlite/message-store';
import {
  createPendingAsk,
  listAllPendingAsks,
} from '@/infrastructure/sqlite/pending-asks';
import {
  addMessageToQueue,
  listQueuedMessages,
} from '@/infrastructure/sqlite/queued-messages';
import { pinMessage, listPinnedMessagesByWorkspace } from '@/infrastructure/sqlite/pinned-messages';
import {
  cleanupOrphanedData,
  vacuumDatabase,
} from '@/infrastructure/sqlite/cleanup';
import { getDatabase } from '@/infrastructure/sqlite/database';
import type { PermissionAsk } from '@jean2/sdk';

function makeSession(overrides: { id: string; workspaceId: string; title: string; status: 'active' | 'closed' }) {
  const { createdAt: _c, updatedAt: _u, ...defaults } = createTestSession(overrides);
  return defaults;
}

const TEST_ASK: PermissionAsk = {
  type: 'permission',
  question: 'Allow test-tool?',
  risk: 'low',
};

describe('cascade deletes and cleanup', () => {
  let sessionId: string;
  let workspaceId: string;

  beforeEach(() => {
    setupTestDatabase();
    const result = seedWorkspaceWithSession();
    sessionId = result.sessionId;
    workspaceId = result.workspaceId;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  // ===========================================================================
  // FK CASCADE: deleteSession should cascade to all child tables
  // ===========================================================================

  describe('deleteSession cascading deletes', () => {
    test('cascades to messages', () => {
      createMessage(createTestUserMessage(sessionId));
      createMessage(createTestAssistantMessage(sessionId));

      deleteSession(sessionId);

      expect(listMessagesWithParts(sessionId)).toHaveLength(0);
    });

    test('cascades to parts', () => {
      const msg = createMessage(createTestUserMessage(sessionId));
      createPart(createTestTextPart(msg.id), sessionId);

      deleteSession(sessionId);

      const db = getDatabase();
      const parts = db.query('SELECT * FROM parts WHERE session_id = ?').all(sessionId);
      expect(parts).toHaveLength(0);
    });

    test('cascades to pending_asks', () => {
      createPendingAsk({
        requestId: 'req-1',
        sessionId,
        toolCallId: 'call-1',
        toolName: 'test-tool',
        ask: TEST_ASK,
        status: 'pending',
        isPermission: true,
        createdAt: Date.now(),
        workspaceId,
      });

      deleteSession(sessionId);

      const asks = listAllPendingAsks();
      expect(asks.filter(a => a.sessionId === sessionId)).toHaveLength(0);
    });

    test('cascades to queued_messages', () => {
      addMessageToQueue(sessionId, 'queued content');

      deleteSession(sessionId);

      expect(listQueuedMessages(sessionId)).toHaveLength(0);
    });

    test('cascades to pinned_messages', () => {
      const assistantMsg = createMessage(createTestAssistantMessage(sessionId));
      createPart(createTestTextPart(assistantMsg.id, 'pinned content'), sessionId);

      pinMessage({ workspaceId, sessionId, messageId: assistantMsg.id });

      deleteSession(sessionId);

      const pinned = listPinnedMessagesByWorkspace(workspaceId);
      expect(pinned).toHaveLength(0);
    });

    test('removes session row', () => {
      expect(getSession(sessionId)).not.toBeNull();

      deleteSession(sessionId);

      expect(getSession(sessionId)).toBeNull();
    });

    test('returns true for deleted, false for non-existent', () => {
      expect(deleteSession(sessionId)).toBe(true);
      expect(deleteSession('nonexistent')).toBe(false);
    });

    test('does not affect other sessions', () => {
      const otherSession = createSession(
        makeSession({ id: 'other-session', workspaceId, title: 'Other', status: 'active' }),
      );
      createMessage(createTestUserMessage(otherSession.id));

      deleteSession(sessionId);

      expect(getSession(otherSession.id)).not.toBeNull();
      expect(listMessagesWithParts(otherSession.id)).toHaveLength(1);
    });
  });

  // ===========================================================================
  // FK CASCADE: deleteSessionsByWorkspace
  // ===========================================================================

  describe('deleteSessionsByWorkspace cascading deletes', () => {
    test('removes all sessions for a workspace', () => {
      createSession(makeSession({ id: 's1', workspaceId, title: 'A', status: 'active' }));
      createSession(makeSession({ id: 's2', workspaceId, title: 'B', status: 'active' }));

      deleteSessionsByWorkspace(workspaceId);

      expect(getSession('s1')).toBeNull();
      expect(getSession('s2')).toBeNull();
    });

    test('cascades to messages and parts for all sessions', () => {
      createSession(makeSession({ id: 's1', workspaceId, title: 'A', status: 'active' }));
      createSession(makeSession({ id: 's2', workspaceId, title: 'B', status: 'active' }));

      createMessage(createTestUserMessage('s1'));
      const msg = createMessage(createTestAssistantMessage('s2'));
      createPart(createTestTextPart(msg.id), 's2');

      deleteSessionsByWorkspace(workspaceId);

      expect(listMessagesWithParts('s1')).toHaveLength(0);
      expect(listMessagesWithParts('s2')).toHaveLength(0);
    });
  });

  // ===========================================================================
  // FK constraints verification
  // ===========================================================================

  describe('FK constraints enabled in production', () => {
    test('PRAGMA foreign_keys is ON', () => {
      const db = getDatabase();
      const result = db.query('PRAGMA foreign_keys').get() as { foreign_keys?: number };
      expect(result?.foreign_keys).toBe(1);
    });
  });

  // ===========================================================================
  // cleanupOrphanedData
  // ===========================================================================

  describe('cleanupOrphanedData', () => {
    test('removes orphaned messages (no matching session)', () => {
      const db = getDatabase();
      // FK constraints prevent inserting orphans directly.
      // Temporarily disable to simulate legacy orphaned data.
      db.run('PRAGMA foreign_keys = OFF');
      db.run(
        'INSERT INTO messages (id, session_id, role, created_at) VALUES (?, ?, ?, ?)',
        ['orphan-msg', 'nonexistent-session', 'user', Date.now()],
      );
      db.run('PRAGMA foreign_keys = ON');

      const stats = cleanupOrphanedData();
      expect(stats.orphanedMessages).toBeGreaterThan(0);

      const stillExists = db.query('SELECT * FROM messages WHERE id = ?').get('orphan-msg') as unknown;
      expect(stillExists).toBeFalsy();
    });

    test('removes orphaned parts', () => {
      const db = getDatabase();
      db.run('PRAGMA foreign_keys = OFF');
      db.run(
        'INSERT INTO parts (id, message_id, session_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['orphan-part', 'nonexistent-msg', sessionId, 'text', '{"text":"x"}', Date.now()],
      );
      db.run('PRAGMA foreign_keys = ON');

      const stats = cleanupOrphanedData();
      expect(stats.orphanedParts).toBeGreaterThan(0);
    });

    test('removes orphaned pending_asks', () => {
      const db = getDatabase();
      db.run('PRAGMA foreign_keys = OFF');
      db.run(
        `INSERT INTO pending_asks (id, session_id, tool_call_id, tool_name, ask_json, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['orphan-ask', 'nonexistent-session', 'call-x', 'tool', '{}', Date.now(), 'pending'],
      );
      db.run('PRAGMA foreign_keys = ON');

      const stats = cleanupOrphanedData();
      expect(stats.orphanedPendingAsks).toBeGreaterThan(0);
    });

    test('returns zero stats for clean database', () => {
      const stats = cleanupOrphanedData();
      expect(stats.orphanedMessages).toBe(0);
      expect(stats.orphanedParts).toBe(0);
      expect(stats.orphanedPendingAsks).toBe(0);
    });
  });

  // ===========================================================================
  // vacuumDatabase
  // ===========================================================================

  describe('vacuumDatabase', () => {
    test('returns stats in dry-run mode without modifying data', () => {
      createMessage(createTestUserMessage(sessionId));
      const msg = createMessage(createTestAssistantMessage(sessionId));
      createPart(createTestTextPart(msg.id), sessionId);

      const result = vacuumDatabase({ dryRun: true });

      expect(result.pageCountBefore).toBeGreaterThan(0);
      expect(result.pageSizeBefore).toBeGreaterThan(0);
      expect(result.reclaimedBytes).toBeGreaterThanOrEqual(0);

      // Data should still be there
      expect(listMessagesWithParts(sessionId)).toHaveLength(2);
    });

    test('reclaims space after creating and deleting data', () => {
      for (let i = 0; i < 20; i++) {
        const msg = createMessage(createTestUserMessage(sessionId));
        createPart(createTestTextPart(msg.id, `content ${i}`), sessionId);
      }

      deleteSession(sessionId);

      const result = vacuumDatabase();

      expect(result.reclaimedBytes).toBeGreaterThanOrEqual(0);
      expect(result.pageCountAfter).toBeGreaterThan(0);
    });

    test('vacuum preserves live data', () => {
      createMessage(createTestUserMessage(sessionId));
      const msg = createMessage(createTestAssistantMessage(sessionId));
      createPart(createTestTextPart(msg.id), sessionId);

      vacuumDatabase();

      // Data should still be there (vacuum reclaims free space, not live data)
      expect(listMessagesWithParts(sessionId)).toHaveLength(2);
    });
  });
});
