import { afterEach, beforeEach, expect, test } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace, seedSession } from '#tests/seed';
import { createMessage, deleteMessage } from '@/infrastructure/sqlite/message-store';
import { deleteSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace, listWorkspaces, updateWorkspace } from '@/infrastructure/sqlite/workspaces';
import { installWorkspaceActivityListener } from '@/application/workspaces/activity';

beforeEach(() => { setupTestDatabase(); seedWorkspace(); });
afterEach(() => { installWorkspaceActivityListener(undefined); resetTestDatabase(); });

test('activity aggregates conversation messages across sessions, not metadata or system messages', () => {
  expect(getWorkspace('ws1')?.lastConversationAt).toBeNull();
  const first = seedSession();
  const second = seedSession();
  createMessage({ id: 'one', sessionId: first.id, role: 'user', createdAt: 100 });
  createMessage({ id: 'two', sessionId: second.id, role: 'user', createdAt: 200 });
  createMessage({ id: 'system', sessionId: first.id, role: 'system', createdAt: 900 });
  updateSession(first.id, { title: 'Renamed' });
  expect(updateWorkspace('ws1', { name: 'Renamed' })?.lastConversationAt).toBe(200);
  expect(listWorkspaces()[0].lastConversationAt).toBe(200);
  deleteSession(second.id);
  expect(getWorkspace('ws1')?.lastConversationAt).toBe(100);
});

test('creation and deletion publish activity, including null when emptied', () => {
  const session = seedSession();
  const events: Array<[string, number | null]> = [];
  installWorkspaceActivityListener((id, activity) => events.push([id, activity]));
  createMessage({ id: 'system', sessionId: session.id, role: 'system', createdAt: 900 });
  expect(events).toHaveLength(0);
  createMessage({ id: 'user', sessionId: session.id, role: 'user', createdAt: 100 });
  expect(events.at(-1)).toEqual(['ws1', 100]);
  deleteMessage('user');
  expect(events.at(-1)).toEqual(['ws1', null]);
});
