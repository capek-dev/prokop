import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '../../helpers/db';
import { seedWorkspaceWithSession, seedSession } from '../../helpers/seed';
import {
  createTestUserMessage,
  createTestAssistantMessage,
  createTestTextPart,
} from '../../helpers/factories';
import {
  createMessage,
  createPart,
} from '@/infrastructure/sqlite/message-store';
import {
  pinMessage,
  unpinMessage,
  listPinnedMessagesByWorkspace,
  isMessagePinned,
  PinnedMessageError,
} from '@/infrastructure/sqlite/pinned-messages';

describe('Pinned Messages Store', () => {
  beforeEach(() => setupTestDatabase());
  afterEach(() => resetTestDatabase());

  describe('pinMessage', () => {
    test('can pin an assistant message', () => {
      const { workspaceId, sessionId } = seedWorkspaceWithSession();
      const msg = createTestAssistantMessage(sessionId);
      createMessage(msg);

      const pinned = pinMessage({
        workspaceId,
        sessionId,
        messageId: msg.id,
      });

      expect(pinned.workspaceId).toBe(workspaceId);
      expect(pinned.sessionId).toBe(sessionId);
      expect(pinned.messageId).toBe(msg.id);
      expect(pinned.preview).toBe('Assistant message');
    });

    test('includes text preview from message parts', () => {
      const { workspaceId, sessionId } = seedWorkspaceWithSession();
      const msg = createTestAssistantMessage(sessionId);
      createMessage(msg);
      createPart(createTestTextPart(msg.id, 'Hello, this is a test response'), sessionId);

      const pinned = pinMessage({
        workspaceId,
        sessionId,
        messageId: msg.id,
      });

      expect(pinned.preview).toBe('Hello, this is a test response');
    });

    test('truncates long preview text', () => {
      const { workspaceId, sessionId } = seedWorkspaceWithSession();
      const msg = createTestAssistantMessage(sessionId);
      createMessage(msg);
      const longText = 'a'.repeat(300);
      createPart(createTestTextPart(msg.id, longText), sessionId);

      const pinned = pinMessage({
        workspaceId,
        sessionId,
        messageId: msg.id,
      });

      expect(pinned.preview.length).toBeLessThanOrEqual(243);
      expect(pinned.preview.endsWith('...')).toBe(true);
    });

    test('includes session title', () => {
      const { workspaceId, sessionId } = seedWorkspaceWithSession();
      const msg = createTestAssistantMessage(sessionId);
      createMessage(msg);

      const pinned = pinMessage({
        workspaceId,
        sessionId,
        messageId: msg.id,
      });

      expect(pinned.sessionTitle).toBe('Test Session');
    });

    test('cannot pin a user message', () => {
      const { workspaceId, sessionId } = seedWorkspaceWithSession();
      const msg = createTestUserMessage(sessionId);
      createMessage(msg);

      expect(() =>
        pinMessage({ workspaceId, sessionId, messageId: msg.id }),
      ).toThrow(PinnedMessageError);

      try {
        pinMessage({ workspaceId, sessionId, messageId: msg.id });
      } catch (err) {
        expect(err).toBeInstanceOf(PinnedMessageError);
        expect((err as PinnedMessageError).code).toBe('message_not_assistant');
      }
    });

    test('cannot pin message from non-existent workspace', () => {
      const { sessionId } = seedWorkspaceWithSession();
      const msg = createTestAssistantMessage(sessionId);
      createMessage(msg);

      expect(() =>
        pinMessage({ workspaceId: 'non-existent', sessionId, messageId: msg.id }),
      ).toThrow(PinnedMessageError);
    });

    test('cannot pin message from non-existent session', () => {
      const { workspaceId } = seedWorkspaceWithSession();
      // Create a message without a valid session - we can't due to FK constraints
      // So we test that pinMessage correctly validates session existence
      expect(() =>
        pinMessage({ workspaceId, sessionId: 'non-existent', messageId: 'non-existent' }),
      ).toThrow(PinnedMessageError);
    });

    test('cannot pin non-existent message', () => {
      const { workspaceId, sessionId } = seedWorkspaceWithSession();

      expect(() =>
        pinMessage({ workspaceId, sessionId, messageId: 'non-existent' }),
      ).toThrow(PinnedMessageError);
    });

    test('cannot pin message from session in different workspace', () => {
      const { workspaceId: _ws1, sessionId: s1 } = seedWorkspaceWithSession();
      const { workspaceId: ws2 } = seedWorkspaceWithSession({ id: 'ws2' });
      const msg = createTestAssistantMessage(s1);
      createMessage(msg);

      expect(() =>
        pinMessage({ workspaceId: ws2, sessionId: s1, messageId: msg.id }),
      ).toThrow(PinnedMessageError);

      try {
        pinMessage({ workspaceId: ws2, sessionId: s1, messageId: msg.id });
      } catch (err) {
        expect((err as PinnedMessageError).code).toBe('session_workspace_mismatch');
      }
    });

    test('cannot pin message from different session', () => {
      const { workspaceId, sessionId: s1 } = seedWorkspaceWithSession();
      const s2 = seedSession(workspaceId);
      const msg = createTestAssistantMessage(s1);
      createMessage(msg);

      expect(() =>
        pinMessage({ workspaceId, sessionId: s2.id, messageId: msg.id }),
      ).toThrow(PinnedMessageError);

      try {
        pinMessage({ workspaceId, sessionId: s2.id, messageId: msg.id });
      } catch (err) {
        expect((err as PinnedMessageError).code).toBe('message_session_mismatch');
      }
    });

    test('duplicate pin is idempotent', () => {
      const { workspaceId, sessionId } = seedWorkspaceWithSession();
      const msg = createTestAssistantMessage(sessionId);
      createMessage(msg);

      const pin1 = pinMessage({ workspaceId, sessionId, messageId: msg.id });
      const pin2 = pinMessage({ workspaceId, sessionId, messageId: msg.id });

      expect(pin1.id).toBe(pin2.id);
      expect(pin1.createdAt).toBe(pin2.createdAt);
    });
  });

  describe('listPinnedMessagesByWorkspace', () => {
    test('returns only pins for specified workspace', () => {
      const { workspaceId: ws1, sessionId: s1 } = seedWorkspaceWithSession();
      const { workspaceId: ws2, sessionId: s2 } = seedWorkspaceWithSession({ id: 'ws2' });

      const msg1 = createTestAssistantMessage(s1);
      createMessage(msg1);
      createPart(createTestTextPart(msg1.id, 'WS1 message'), s1);

      const msg2 = createTestAssistantMessage(s2);
      createMessage(msg2);
      createPart(createTestTextPart(msg2.id, 'WS2 message'), s2);

      pinMessage({ workspaceId: ws1, sessionId: s1, messageId: msg1.id });
      pinMessage({ workspaceId: ws2, sessionId: s2, messageId: msg2.id });

      const ws1Pins = listPinnedMessagesByWorkspace(ws1);
      const ws2Pins = listPinnedMessagesByWorkspace(ws2);

      expect(ws1Pins).toHaveLength(1);
      expect(ws1Pins[0].messageId).toBe(msg1.id);
      expect(ws2Pins).toHaveLength(1);
      expect(ws2Pins[0].messageId).toBe(msg2.id);
    });

    test('returns empty array for workspace with no pins', () => {
      const { workspaceId } = seedWorkspaceWithSession();
      const pins = listPinnedMessagesByWorkspace(workspaceId);
      expect(pins).toEqual([]);
    });
  });

  describe('unpinMessage', () => {
    test('removes a pin', () => {
      const { workspaceId, sessionId } = seedWorkspaceWithSession();
      const msg = createTestAssistantMessage(sessionId);
      createMessage(msg);

      pinMessage({ workspaceId, sessionId, messageId: msg.id });
      expect(isMessagePinned(workspaceId, msg.id)).toBe(true);

      const removed = unpinMessage(workspaceId, msg.id);
      expect(removed).toBe(true);
      expect(isMessagePinned(workspaceId, msg.id)).toBe(false);
    });

    test('returns false if pin did not exist', () => {
      const { workspaceId } = seedWorkspaceWithSession();
      const removed = unpinMessage(workspaceId, 'non-existent');
      expect(removed).toBe(false);
    });
  });

  describe('isMessagePinned', () => {
    test('returns true for pinned message', () => {
      const { workspaceId, sessionId } = seedWorkspaceWithSession();
      const msg = createTestAssistantMessage(sessionId);
      createMessage(msg);

      pinMessage({ workspaceId, sessionId, messageId: msg.id });
      expect(isMessagePinned(workspaceId, msg.id)).toBe(true);
    });

    test('returns false for unpinned message', () => {
      const { workspaceId } = seedWorkspaceWithSession();
      expect(isMessagePinned(workspaceId, 'some-message')).toBe(false);
    });
  });

  describe('cascade deletes', () => {
    test('deleting session cascades pins', () => {
      const { workspaceId, sessionId } = seedWorkspaceWithSession();
      const msg = createTestAssistantMessage(sessionId);
      createMessage(msg);

      pinMessage({ workspaceId, sessionId, messageId: msg.id });
      expect(isMessagePinned(workspaceId, msg.id)).toBe(true);

      const { getDatabase } = require('@/infrastructure/sqlite/database');
      const db = getDatabase();
      db.run('PRAGMA foreign_keys = ON');
      db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);

      expect(isMessagePinned(workspaceId, msg.id)).toBe(false);
    });
  });
});
