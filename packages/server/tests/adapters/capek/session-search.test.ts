import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSessionSearchHost, getSessionSearchHost } from '@capekai/core/compat/jean2';
import {
  configureJean2SessionSearchHost,
  jean2SessionSearchHost,
} from '@/adapters/capek/session-search';
import {
  createMessage,
  createPart,
  getSession,
  getWorkspace,
} from '@/store';
import { searchMessages } from '@/session-search/fts';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { createTestTextPart, createTestUserMessage } from '#tests/factories';
import { seedSession, seedWorkspace } from '#tests/seed';

describe('Čapek session search adapter', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  afterEach(() => {
    configureSessionSearchHost();
    resetTestDatabase();
  });

  test('wraps workspace, session, and message search operations by identity', () => {
    expect(jean2SessionSearchHost.getWorkspace).toBe(getWorkspace);
    expect(jean2SessionSearchHost.getSession).toBe(getSession);
    expect(jean2SessionSearchHost.searchMessages).toBe(searchMessages);
  });

  test('counts messages with the original before and after boundaries', () => {
    seedWorkspace({ id: 'workspace-search' });
    const session = seedSession('workspace-search');
    createMessage(createTestUserMessage(session.id, { id: 'm1', createdAt: 100 }));
    createMessage(createTestUserMessage(session.id, { id: 'm2', createdAt: 200 }));

    expect(jean2SessionSearchHost.countSessionMessages(session.id)).toBe(2);
    expect(jean2SessionSearchHost.countMessagesBefore(session.id, 100)).toBe(0);
    expect(jean2SessionSearchHost.countMessagesBefore(session.id, 200)).toBe(1);
    expect(jean2SessionSearchHost.countMessagesAfter(session.id, 100)).toBe(1);
    expect(jean2SessionSearchHost.countMessagesAfter(session.id, 200)).toBe(0);
    expect(jean2SessionSearchHost.countSessionMessages('missing')).toBe(0);
  });

  test('returns latest and surrounding messages in the original order and row shape', () => {
    seedWorkspace({ id: 'workspace-search' });
    const session = seedSession('workspace-search');
    createMessage(createTestUserMessage(session.id, { id: 'm1', createdAt: 100 }));
    createMessage(createTestUserMessage(session.id, { id: 'm2', createdAt: 200 }));

    expect(jean2SessionSearchHost.getLatestMessage(session.id)).toEqual({ id: 'm2', timestamp: 200 });
    expect(jean2SessionSearchHost.getLatestMessage('missing')).toBeNull();

    expect(jean2SessionSearchHost.listMessagesBefore(session.id, 300, 10)).toEqual([
      { id: 'm2', role: 'user', timestamp: 200 },
      { id: 'm1', role: 'user', timestamp: 100 },
    ]);
    expect(jean2SessionSearchHost.listMessagesAfter(session.id, 0, 10)).toEqual([
      { id: 'm1', role: 'user', timestamp: 100 },
      { id: 'm2', role: 'user', timestamp: 200 },
    ]);

    expect(jean2SessionSearchHost.getMessage('m1', session.id)).toEqual({ id: 'm1', timestamp: 100 });
    expect(jean2SessionSearchHost.getMessage('m1', 'other-session')).toBeNull();
    expect(jean2SessionSearchHost.getMessage('missing', session.id)).toBeNull();
  });

  test('summarizes messages with the original fts content extraction shape', () => {
    seedWorkspace({ id: 'workspace-search' });
    const session = seedSession('workspace-search');
    createMessage(createTestUserMessage(session.id, { id: 'm1', createdAt: 100 }));
    createPart(createTestTextPart('m1', 'hello world'), session.id);

    expect(jean2SessionSearchHost.getMessageSummary('m1')).toEqual({
      role: 'user',
      timestamp: 100,
      content: 'hello world',
      toolName: '',
    });
    expect(jean2SessionSearchHost.getMessageSummary('missing')).toBeNull();
  });

  test('lists workspace sessions with the root-only projection', () => {
    const workspace = seedWorkspace({ id: 'workspace-search' });
    const root = seedSession(workspace.id);
    seedSession(workspace.id, { parentId: root.id });

    const sessions = jean2SessionSearchHost.listWorkspaceSessions(workspace.id);
    expect(sessions.map((session) => session.id)).toEqual([root.id]);
  });

  test('installs the module-level session search host by identity', () => {
    configureJean2SessionSearchHost();
    expect(getSessionSearchHost()).toBe(jean2SessionSearchHost);
  });
});
