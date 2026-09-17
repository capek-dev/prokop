import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import type { SelectedContextRecord } from '@prokopai/sdk';
import { getSelectedContext, initializeSelectedContextSchema, saveSelectedContext } from '@/infrastructure/sqlite/selected-context';
import { createMessage } from '@/infrastructure/sqlite/message-store';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';
import { createTestAssistantMessage, createTestUserMessage } from '#tests/factories';

let db: Database;
let record: SelectedContextRecord;
beforeEach(() => {
  db = setupTestDatabase();
  seedWorkspace();
  seedSession('ws1', { id: 'session' });
  record = { sessionId: 'session', assistantMessageId: 'response', continuation: false, createdAt: new Date().toISOString(),
    outcome: 'selected', threshold: 2, elapsedMs: 1, excluded: [],
    items: [{ id: 'item', name: 'MEMORY.md', revision: 'original-revision', source: 'agent', kind: 'memory', inclusion: 'selected', content: 'original content', score: 3 }],
  };
});
afterEach(() => { resetTestDatabase(); db.close(); });

describe('immutable selected-context storage', () => {
  test('corrupt, mismatched and obsolete snapshots are unavailable, not unsafe wire data', () => {
    saveSelectedContext(record);
    createMessage(createTestAssistantMessage('session', { id: 'response' }));
    for (const snapshot of ['broken json', '{}', JSON.stringify({ ...record, sessionId: 'other' })]) {
      db.run('UPDATE selected_context SET snapshot = ?', [snapshot]);
      expect(getSelectedContext('session', 'response')).toBeNull();
    }
  });
  test('preparations stay hidden until the exact assistant message exists', () => {
    saveSelectedContext(record);
    expect(getSelectedContext('session', 'response')).toBeNull();
    createMessage(createTestAssistantMessage('session', { id: 'response' }));
    expect(getSelectedContext('session', 'response')).toEqual(record);
    expect(getSelectedContext('other-session', 'response')).toBeNull();
    record.items[0].content = 'edited after assembly';
    expect(getSelectedContext('session', 'response')?.items[0].content).toBe('original content');
    expect(() => saveSelectedContext(record)).toThrow();
  });
  test('mismatched session and user messages never expose preparations', () => {
    seedSession('ws1', { id: 'other' });
    saveSelectedContext(record);
    createMessage(createTestAssistantMessage('other', { id: 'response' }));
    expect(getSelectedContext('session', 'response')).toBeNull();
    saveSelectedContext({ ...record, assistantMessageId: 'user' });
    createMessage(createTestUserMessage('session', { id: 'user' }));
    expect(getSelectedContext('session', 'user')).toBeNull();
  });
  test('message and session deletion remove snapshots, including pending preparations', () => {
    saveSelectedContext(record);
    createMessage(createTestAssistantMessage('session', { id: 'response' }));
    db.run('DELETE FROM messages WHERE id = ?', ['response']);
    expect(db.query('SELECT * FROM selected_context').all()).toHaveLength(0);
    saveSelectedContext({ ...record, assistantMessageId: 'pending' });
    db.run('DELETE FROM sessions WHERE id = ?', ['session']);
    expect(db.query('SELECT * FROM selected_context').all()).toHaveLength(0);
  });
  test('startup clears abandoned preparations but keeps historical invocations', () => {
    saveSelectedContext(record);
    createMessage(createTestAssistantMessage('session', { id: 'response' }));
    saveSelectedContext({ ...record, assistantMessageId: 'pending' });
    initializeSelectedContextSchema(db);
    expect(db.query('SELECT assistant_message_id FROM selected_context').all()).toEqual([{ assistant_message_id: 'response' }]);
  });
  test('oversized snapshots are rejected whole rather than silently truncated', () => {
    record.items[0].content = 'x'.repeat(512001);
    expect(() => saveSelectedContext(record)).toThrow('storage limit');
    expect(db.query('SELECT * FROM selected_context').all()).toHaveLength(0);
  });
});
