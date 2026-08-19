import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSessionSearchHost, getSessionSearchHost } from '@capekai/core/hosts';
import {
  configureJean2SessionSearchHost,
  createJean2SessionSearchHost,
  jean2SessionSearchHost,
  type Jean2SessionSearchHostDeps,
} from '@/adapters/capek/session-search';
import { createMessage, createPart } from '@/infrastructure/sqlite/message-store';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import {
  createTestSession,
  createTestTextPart,
  createTestUserMessage,
} from '#tests/factories';
import { seedSession, seedWorkspace } from '#tests/seed';
import type { Session, Workspace } from '@jean2/sdk';
import type {
  SessionSearchMessageResult,
  SessionSearchOptions,
  SessionSearchQueryPort,
} from '@/application/ports/session-search';

function makeFakeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-fake',
    workspaceId: 'ws-fake',
    preconfigId: null,
    title: 'Fake Session',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: null,
    ...overrides,
  } as Session;
}

function makeFakeWorkspace(): Workspace {
  return {
    id: 'ws-fake',
    name: 'Fake Workspace',
    path: '/fake',
    isVirtual: false,
    additionalPaths: [],
    settings: {},
    createdAt: '',
    updatedAt: '',
  } as Workspace;
}

interface FakeHostDeps {
  deps: Jean2SessionSearchHostDeps;
  calls: string[];
  values: {
    workspace: Workspace;
    session: Session;
    messageResult: SessionSearchMessageResult;
    latest: { id: string; timestamp: number };
    message: { id: string; timestamp: number };
    before: Array<{ id: string; role: string; timestamp: number }>;
    after: Array<{ id: string; role: string; timestamp: number }>;
    summary: { role: string; timestamp: number; content: string; toolName: string };
    searchOptions: SessionSearchOptions | null;
  };
}

function makeFakeDeps(): FakeHostDeps {
  const calls: string[] = [];

  const values: FakeHostDeps['values'] = {
    workspace: makeFakeWorkspace(),
    session: makeFakeSession(),
    messageResult: {
      messageId: 'm1',
      sessionId: 'session-fake',
      workspaceId: 'ws-fake',
      role: 'user',
      content: 'snippet',
      timestamp: 100,
      sessionTitle: 'Fake Session',
      rank: 1,
    },
    latest: { id: 'm2', timestamp: 200 },
    message: { id: 'm1', timestamp: 100 },
    before: [{ id: 'm1', role: 'user', timestamp: 100 }],
    after: [{ id: 'm2', role: 'assistant', timestamp: 200 }],
    summary: { role: 'user', timestamp: 100, content: 'text', toolName: 'tool' },
    searchOptions: null,
  };

  const query: SessionSearchQueryPort = {
    searchMessages: async (options) => {
      calls.push('searchMessages');
      values.searchOptions = options;
      return [values.messageResult];
    },
    countSessionMessages: async () => {
      calls.push('countSessionMessages');
      return 7;
    },
    countMessagesBefore: async () => {
      calls.push('countMessagesBefore');
      return 3;
    },
    countMessagesAfter: async () => {
      calls.push('countMessagesAfter');
      return 2;
    },
    getLatestMessage: async () => {
      calls.push('getLatestMessage');
      return values.latest;
    },
    getMessage: async () => {
      calls.push('getMessage');
      return values.message;
    },
    listMessagesBefore: async () => {
      calls.push('listMessagesBefore');
      return values.before;
    },
    listMessagesAfter: async () => {
      calls.push('listMessagesAfter');
      return values.after;
    },
    getMessageSummary: async () => {
      calls.push('getMessageSummary');
      return values.summary;
    },
  };

  const deps: Jean2SessionSearchHostDeps = {
    query,
    sessions: {
      getSession: () => {
        calls.push('getSession');
        return values.session;
      },
      listWorkspaceSessions: () => {
        calls.push('listWorkspaceSessions');
        return [values.session];
      },
      listAgentSessions: () => {
        calls.push('listAgentSessions');
        return [values.session];
      },
    },
    workspaces: {
      getWorkspace: () => {
        calls.push('getWorkspace');
        return values.workspace;
      },
    },
  };

  return { deps, calls, values };
}

describe('Čapek session search adapter', () => {
  describe('unconfigured module host', () => {
    test('answers with the Capek empty-host defaults after a reset configure', async () => {
      configureJean2SessionSearchHost();
      expect(getSessionSearchHost()).toBe(jean2SessionSearchHost);
      expect(await jean2SessionSearchHost.getWorkspace('any')).toBeNull();
      expect(await jean2SessionSearchHost.getSession('any')).toBeNull();
      expect(await jean2SessionSearchHost.listWorkspaceSessions('any')).toEqual([]);
      expect(await jean2SessionSearchHost.listAgentSessions('any', 10)).toEqual([]);
      expect(await jean2SessionSearchHost.countSessionMessages('any')).toBe(0);
      expect(await jean2SessionSearchHost.searchMessages({
        query: 'x',
        roleFilter: ['user'],
        limit: 10,
        sort: 'relevance',
      })).toEqual([]);
      expect(await jean2SessionSearchHost.countMessagesBefore('any', 0)).toBe(0);
      expect(await jean2SessionSearchHost.countMessagesAfter('any', 0)).toBe(0);
      expect(await jean2SessionSearchHost.getLatestMessage('any')).toBeNull();
      expect(await jean2SessionSearchHost.getMessage('any', 'any')).toBeNull();
      expect(await jean2SessionSearchHost.listMessagesBefore('any', 0, 10)).toEqual([]);
      expect(await jean2SessionSearchHost.listMessagesAfter('any', 0, 10)).toEqual([]);
      expect(await jean2SessionSearchHost.getMessageSummary('any')).toBeNull();
    });
  });

  describe('factory host contract', () => {
    test('delegates every host method exactly once to the matching dep without reshaping', async () => {
      const { deps, calls, values } = makeFakeDeps();
      const host = createJean2SessionSearchHost(deps);

      expect(await host.getWorkspace('ws-fake')).toBe(values.workspace);
      expect(await host.getSession('session-fake')).toBe(values.session);
      expect(await host.listWorkspaceSessions('ws-fake')).toEqual([values.session]);
      expect(await host.listAgentSessions('agent-1', 5)).toEqual([values.session]);
      expect(await host.countSessionMessages('session-fake')).toBe(7);
      expect(await host.countMessagesBefore('session-fake', 100)).toBe(3);
      expect(await host.countMessagesAfter('session-fake', 100)).toBe(2);
      expect(await host.getLatestMessage('session-fake')).toBe(values.latest);
      expect(await host.getMessage('m1', 'session-fake')).toBe(values.message);
      expect(await host.listMessagesBefore('session-fake', 300, 10)).toBe(values.before);
      expect(await host.listMessagesAfter('session-fake', 0, 10)).toBe(values.after);
      expect(await host.getMessageSummary('m1')).toBe(values.summary);

      const searchOptions: SessionSearchOptions = {
        query: 'snippet',
        workspaceId: 'ws-fake',
        roleFilter: ['user', 'assistant'],
        limit: 5,
        sort: 'relevance',
      };
      expect(await host.searchMessages(searchOptions)).toEqual([values.messageResult]);
      expect(values.searchOptions).toBe(searchOptions);

      expect(calls).toEqual([
        'getWorkspace',
        'getSession',
        'listWorkspaceSessions',
        'listAgentSessions',
        'countSessionMessages',
        'countMessagesBefore',
        'countMessagesAfter',
        'getLatestMessage',
        'getMessage',
        'listMessagesBefore',
        'listMessagesAfter',
        'getMessageSummary',
        'searchMessages',
      ]);
    });
  });

  describe('configured module host', () => {
    test('installs by identity and delegates to the configured deps', async () => {
      const { deps, values } = makeFakeDeps();
      configureJean2SessionSearchHost(deps);

      expect(getSessionSearchHost()).toBe(jean2SessionSearchHost);
      expect(await jean2SessionSearchHost.getWorkspace('ws-fake')).toBe(values.workspace);
      expect(await jean2SessionSearchHost.getSession('session-fake')).toBe(values.session);
      expect(await jean2SessionSearchHost.listWorkspaceSessions('ws-fake')).toEqual([values.session]);
      expect(await jean2SessionSearchHost.listAgentSessions('agent-1', 3)).toEqual([values.session]);
      expect(await jean2SessionSearchHost.countSessionMessages('session-fake')).toBe(7);
      expect(await jean2SessionSearchHost.searchMessages({
        query: 'snippet',
        roleFilter: ['user'],
        limit: 5,
        sort: 'relevance',
      })).toEqual([values.messageResult]);
    });
  });

  describe('adapter reset safety', () => {
    test('empty-host defaults hold regardless of adapter and database reset order', async () => {
      const { deps } = makeFakeDeps();
      configureJean2SessionSearchHost(deps);
      expect(await jean2SessionSearchHost.countSessionMessages('any')).toBe(7);

      resetTestDatabase();
      configureJean2SessionSearchHost();
      expect(getSessionSearchHost()).toBe(jean2SessionSearchHost);
      configureSessionSearchHost();
      expect(await jean2SessionSearchHost.countSessionMessages('any')).toBe(0);

      configureJean2SessionSearchHost(deps);
      expect(await jean2SessionSearchHost.countSessionMessages('any')).toBe(7);

      configureJean2SessionSearchHost();
      expect(getSessionSearchHost()).toBe(jean2SessionSearchHost);
      resetTestDatabase();
      configureSessionSearchHost();
      expect(await jean2SessionSearchHost.countSessionMessages('any')).toBe(0);
    });
  });

  describe('wired sqlite-backed host', () => {
    beforeEach(() => {
      setupTestDatabase();
    });

    afterEach(() => {
      configureJean2SessionSearchHost();
      configureSessionSearchHost();
      resetTestDatabase();
    });

    test('counts messages with the original before and after boundaries', async () => {
      seedWorkspace({ id: 'workspace-search' });
      const session = seedSession('workspace-search');
      createMessage(createTestUserMessage(session.id, { id: 'm1', createdAt: 100 }));
      createMessage(createTestUserMessage(session.id, { id: 'm2', createdAt: 200 }));

      expect(await jean2SessionSearchHost.countSessionMessages(session.id)).toBe(2);
      expect(await jean2SessionSearchHost.countMessagesBefore(session.id, 100)).toBe(0);
      expect(await jean2SessionSearchHost.countMessagesBefore(session.id, 200)).toBe(1);
      expect(await jean2SessionSearchHost.countMessagesAfter(session.id, 100)).toBe(1);
      expect(await jean2SessionSearchHost.countMessagesAfter(session.id, 200)).toBe(0);
      expect(await jean2SessionSearchHost.countSessionMessages('missing')).toBe(0);
    });

    test('returns latest and surrounding messages in the original order and row shape', async () => {
      seedWorkspace({ id: 'workspace-search' });
      const session = seedSession('workspace-search');
      createMessage(createTestUserMessage(session.id, { id: 'm1', createdAt: 100 }));
      createMessage(createTestUserMessage(session.id, { id: 'm2', createdAt: 200 }));

      expect(await jean2SessionSearchHost.getLatestMessage(session.id)).toEqual({ id: 'm2', timestamp: 200 });
      expect(await jean2SessionSearchHost.getLatestMessage('missing')).toBeNull();

      expect(await jean2SessionSearchHost.listMessagesBefore(session.id, 300, 10)).toEqual([
        { id: 'm2', role: 'user', timestamp: 200 },
        { id: 'm1', role: 'user', timestamp: 100 },
      ]);
      expect(await jean2SessionSearchHost.listMessagesAfter(session.id, 0, 10)).toEqual([
        { id: 'm1', role: 'user', timestamp: 100 },
        { id: 'm2', role: 'user', timestamp: 200 },
      ]);

      expect(await jean2SessionSearchHost.getMessage('m1', session.id)).toEqual({ id: 'm1', timestamp: 100 });
      expect(await jean2SessionSearchHost.getMessage('m1', 'other-session')).toBeNull();
      expect(await jean2SessionSearchHost.getMessage('missing', session.id)).toBeNull();
    });

    test('summarizes messages with the original fts content extraction shape', async () => {
      seedWorkspace({ id: 'workspace-search' });
      const session = seedSession('workspace-search');
      createMessage(createTestUserMessage(session.id, { id: 'm1', createdAt: 100 }));
      createPart(createTestTextPart('m1', 'hello world'), session.id);

      expect(await jean2SessionSearchHost.getMessageSummary('m1')).toEqual({
        role: 'user',
        timestamp: 100,
        content: 'hello world',
        toolName: '',
      });
      expect(await jean2SessionSearchHost.getMessageSummary('missing')).toBeNull();
    });

    test('lists workspace sessions with the root-only projection', async () => {
      const workspace = seedWorkspace({ id: 'workspace-search' });
      const root = seedSession(workspace.id);
      seedSession(workspace.id, { parentId: root.id });

      const sessions = await jean2SessionSearchHost.listWorkspaceSessions(workspace.id);
      expect(sessions.map((session) => session.id)).toEqual([root.id]);
    });

    test('lists agent sessions with the original agent and limit semantics', async () => {
      seedWorkspace({ id: 'workspace-search' });
      createSession(createTestSession({
        id: 'agent-session-1',
        workspaceId: 'workspace-search',
        agentId: 'agent-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }));
      createSession(createTestSession({
        id: 'agent-session-2',
        workspaceId: 'workspace-search',
        agentId: 'agent-1',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }));
      createSession(createTestSession({ id: 'other-agent', workspaceId: 'workspace-search', agentId: 'agent-2' }));
      createSession(createTestSession({
        id: 'agent-child',
        workspaceId: 'workspace-search',
        agentId: 'agent-1',
        parentId: 'agent-session-1',
        updatedAt: '2026-01-03T00:00:00.000Z',
      }));

      expect((await jean2SessionSearchHost.listAgentSessions('agent-1', 10)).map((s) => s.id)).toEqual([
        'agent-session-2',
        'agent-session-1',
      ]);
      expect((await jean2SessionSearchHost.listAgentSessions('agent-1', 1)).map((s) => s.id)).toEqual([
        'agent-session-2',
      ]);
      expect(await jean2SessionSearchHost.listAgentSessions('missing', 10)).toEqual([]);
    });

    test('searches indexed messages end to end with the original result shape', async () => {
      seedWorkspace({ id: 'workspace-search' });
      const session = seedSession('workspace-search');
      createMessage(createTestUserMessage(session.id, { id: 'm1', createdAt: 100 }));
      createPart(createTestTextPart('m1', 'hello searchable world'), session.id);

      const results = await jean2SessionSearchHost.searchMessages({
        query: 'searchable',
        workspaceId: 'workspace-search',
        roleFilter: ['user', 'assistant'],
        limit: 10,
        sort: 'relevance',
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        messageId: 'm1',
        sessionId: session.id,
        workspaceId: 'workspace-search',
        role: 'user',
        content: expect.stringContaining('searchable'),
        timestamp: 100,
        sessionTitle: session.title,
        rank: 1,
      });
    });

    test('installs the module-level session search host by identity', () => {
      configureJean2SessionSearchHost();
      expect(getSessionSearchHost()).toBe(jean2SessionSearchHost);
    });
  });
});
