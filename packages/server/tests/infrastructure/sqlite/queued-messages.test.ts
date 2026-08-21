import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import {
  createQueuedMessage,
  getQueuedMessage,
  listQueuedMessages,
  deleteQueuedMessage,
  deleteQueuedMessagesBySession,
  getNextQueuedMessage,
  getQueuedMessageCount,
  addMessageToQueue,
} from '@/infrastructure/sqlite/queued-messages';
import type { QueuedMessage } from '@prokopai/sdk';

describe('queued-messages store', () => {
  let sessionId: string;

  beforeEach(() => {
    setupTestDatabase();
    const result = seedWorkspaceWithSession();
    sessionId = result.sessionId;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function createTestQueuedMsg(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
    return {
      id: overrides.id ?? crypto.randomUUID(),
      sessionId: overrides.sessionId ?? sessionId,
      content: overrides.content ?? 'hello',
      position: overrides.position ?? 0,
      createdAt: overrides.createdAt ?? Date.now(),
      ...overrides,
    };
  }

  describe('CRUD', () => {
    test('createQueuedMessage and getQueuedMessage roundtrip', () => {
      const msg = createQueuedMessage(createTestQueuedMsg({ id: 'qm1', content: 'test message' }));

      expect(msg.id).toBe('qm1');
      expect(msg.content).toBe('test message');

      const retrieved = getQueuedMessage('qm1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.content).toBe('test message');
    });

    test('getQueuedMessage returns null for non-existent', () => {
      expect(getQueuedMessage('nonexistent')).toBeNull();
    });

    test('createQueuedMessage preserves attachments', () => {
      const _msg = createQueuedMessage(createTestQueuedMsg({
        id: 'qm2',
        attachments: [{ id: 'att1', kind: 'file' }],
      }));

      const retrieved = getQueuedMessage('qm2');
      expect(retrieved!.attachments).toHaveLength(1);
      expect(retrieved!.attachments![0].id).toBe('att1');
    });

    test('listQueuedMessages returns messages ordered by position', () => {
      createQueuedMessage(createTestQueuedMsg({ id: 'qm1', position: 2 }));
      createQueuedMessage(createTestQueuedMsg({ id: 'qm2', position: 0 }));
      createQueuedMessage(createTestQueuedMsg({ id: 'qm3', position: 1 }));

      const messages = listQueuedMessages(sessionId);
      expect(messages).toHaveLength(3);
      expect(messages[0].id).toBe('qm2');
      expect(messages[1].id).toBe('qm3');
      expect(messages[2].id).toBe('qm1');
    });

    test('deleteQueuedMessage removes message', () => {
      createQueuedMessage(createTestQueuedMsg({ id: 'qm1' }));

      expect(deleteQueuedMessage('qm1')).toBe(true);
      expect(getQueuedMessage('qm1')).toBeNull();
    });

    test('deleteQueuedMessage returns false for non-existent', () => {
      expect(deleteQueuedMessage('nonexistent')).toBe(false);
    });

    test('deleteQueuedMessagesBySession removes all for session', () => {
      createQueuedMessage(createTestQueuedMsg({ id: 'qm1' }));
      createQueuedMessage(createTestQueuedMsg({ id: 'qm2' }));

      const count = deleteQueuedMessagesBySession(sessionId);
      expect(count).toBe(2);
      expect(listQueuedMessages(sessionId)).toHaveLength(0);
    });
  });

  describe('queue operations', () => {
    test('getNextQueuedMessage returns first by position', () => {
      createQueuedMessage(createTestQueuedMsg({ id: 'qm1', position: 0, content: 'first' }));
      createQueuedMessage(createTestQueuedMsg({ id: 'qm2', position: 1, content: 'second' }));

      const next = getNextQueuedMessage(sessionId);
      expect(next).not.toBeNull();
      expect(next!.content).toBe('first');
    });

    test('getNextQueuedMessage returns null when empty', () => {
      expect(getNextQueuedMessage(sessionId)).toBeNull();
    });

    test('getQueuedMessageCount returns count', () => {
      createQueuedMessage(createTestQueuedMsg({ id: 'qm1', position: 0 }));
      createQueuedMessage(createTestQueuedMsg({ id: 'qm2', position: 1 }));

      expect(getQueuedMessageCount(sessionId)).toBe(2);
    });

    test('getQueuedMessageCount returns 0 when empty', () => {
      expect(getQueuedMessageCount(sessionId)).toBe(0);
    });

    test('addMessageToQueue auto-increments position', () => {
      addMessageToQueue(sessionId, 'first');
      addMessageToQueue(sessionId, 'second');
      addMessageToQueue(sessionId, 'third');

      const messages = listQueuedMessages(sessionId);
      expect(messages).toHaveLength(3);
      expect(messages[0].position).toBe(0);
      expect(messages[1].position).toBe(1);
      expect(messages[2].position).toBe(2);
      expect(messages[0].content).toBe('first');
      expect(messages[2].content).toBe('third');
    });

    test('addMessageToQueue generates id and timestamp', () => {
      const msg = addMessageToQueue(sessionId, 'test');

      expect(msg.id).toBeDefined();
      expect(msg.sessionId).toBe(sessionId);
      expect(msg.content).toBe('test');
      expect(msg.createdAt).toBeGreaterThan(0);
    });
  });
});
