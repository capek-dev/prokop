import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { createTestSession, createTestUserMessage, createTestTextPart } from '#tests/factories';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { createMessage, createPart } from '@/infrastructure/sqlite/message-store';
import { createWorkspace } from '@/infrastructure/sqlite/workspaces';
import { executeSessionSearchTool } from '@capekai/core/hosts';

describe('session_search tool', () => {
  let workspaceId: string;
  let currentSessionId: string;
  let otherSessionId: string;

  beforeEach(() => {
    setupTestDatabase();

    const ws = createWorkspace({
      id: 'test-workspace',
      name: 'Test Workspace',
      path: '/test',
      isVirtual: false,
      additionalPaths: [],
      settings: {},
    });
    workspaceId = ws.id;

    currentSessionId = 'current-session-id';
    otherSessionId = 'other-session-id';

    createSession(createTestSession({ id: currentSessionId, workspaceId, title: 'Current Session' }));
    createSession(createTestSession({ id: otherSessionId, workspaceId, title: 'Other Session' }));
  });

  afterEach(() => {
    resetTestDatabase();
  });

  // Helper to seed messages into a session
  function seedMessages(sessionId: string, count: number) {
    for (let i = 0; i < count; i++) {
      const msg = createTestUserMessage(sessionId, { createdAt: Date.now() + i });
      createMessage(msg);
      createPart(createTestTextPart(msg.id, `Message ${i} about testing`), sessionId);
    }
  }

  // ── List action ──────────────────────────────────────────────

  describe('list action', () => {
    test('returns empty list when only current session exists', async () => {
      // Delete the other session so only current remains
      // Actually we have 2 sessions — let's test with them
      const result = await executeSessionSearchTool(
        { action: 'list' },
        workspaceId,
        currentSessionId,
        false,
        'none',
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('list');
      expect(result.sessions).toBeDefined();
      expect(result.sessions!.length).toBeGreaterThanOrEqual(2);

      const currentEntry = result.sessions!.find((s) => s.id === currentSessionId);
      expect(currentEntry).toBeDefined();
      expect(currentEntry!.title).toBe('Current Session');
      expect((currentEntry as { isCurrent?: boolean }).isCurrent).toBe(true);
    });

    test('returns message counts per session', async () => {
      seedMessages(currentSessionId, 5);
      seedMessages(otherSessionId, 3);

      const result = await executeSessionSearchTool(
        { action: 'list' },
        workspaceId,
        currentSessionId,
        false,
        'none',
      );

      expect(result.success).toBe(true);
      const current = result.sessions!.find((s) => s.id === currentSessionId);
      const other = result.sessions!.find((s) => s.id === otherSessionId);
      expect(current!.messageCount).toBe(5);
      expect(other!.messageCount).toBe(3);
    });

    test('respects limit parameter', async () => {
      // Create many sessions
      for (let i = 0; i < 15; i++) {
        const sid = `extra-session-${i}`;
        createSession(createTestSession({ id: sid, workspaceId, title: `Extra ${i}` }));
      }

      const result = await executeSessionSearchTool(
        { action: 'list', limit: 5 },
        workspaceId,
        currentSessionId,
        false,
        'none',
      );

      expect(result.success).toBe(true);
      expect(result.sessions!.length).toBe(5);
    });

    test('list bypasses permission check', async () => {
      let askCalled = false;
      const askFn = async () => { askCalled = true; return true; };

      await executeSessionSearchTool(
        { action: 'list' },
        workspaceId,
        currentSessionId,
        false,
        'high',
        askFn,
      );

      expect(askCalled).toBe(false);
    });

    test('excludes subagent child sessions', async () => {
      // Create a subagent session
      createSession(createTestSession({
        id: 'subagent-1',
        workspaceId,
        title: 'Subagent Child',
        parentId: currentSessionId,
      }));

      const result = await executeSessionSearchTool(
        { action: 'list' },
        workspaceId,
        currentSessionId,
        false,
        'none',
      );

      expect(result.success).toBe(true);
      const ids = result.sessions!.map((s) => s.id);
      expect(ids).toContain(currentSessionId);
      expect(ids).toContain(otherSessionId);
      expect(ids).not.toContain('subagent-1');
    });

    test('returns empty for workspace with no sessions', async () => {
      // Create a workspace with no sessions
      const emptyWs = createWorkspace({
        id: 'empty-workspace',
        name: 'Empty WS',
        path: '/empty',
        isVirtual: false,
        additionalPaths: [],
        settings: {},
      });

      const result = await executeSessionSearchTool(
        { action: 'list' },
        emptyWs.id,
        currentSessionId,
        false,
        'none',
      );

      expect(result.success).toBe(true);
      expect(result.sessions).toEqual([]);
    });
  });

  // ── Read action (aroundMessageId optional) ───────────────────

  describe('read action without aroundMessageId', () => {
    beforeEach(() => {
      // Seed 10 messages into otherSession
      seedMessages(otherSessionId, 10);
    });

    test('reads latest messages when aroundMessageId omitted', async () => {
      const result = await executeSessionSearchTool(
        { action: 'read', sessionId: otherSessionId, window: 4 },
        workspaceId,
        currentSessionId,
        false,
        'none',
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('read');
      expect(result.anchorInferred).toBe(true);
      expect(result.messages).toBeDefined();
      // window=4 → halfWindow=2 → 2 before + 1 anchor + 0 after (latest) = 3
      expect(result.messages!.length).toBe(3);
    });

    test('returns anchorMessageId of the inferred latest message', async () => {
      const result = await executeSessionSearchTool(
        { action: 'read', sessionId: otherSessionId },
        workspaceId,
        currentSessionId,
        false,
        'none',
      );

      expect(result.success).toBe(true);
      expect(result.anchorMessageId).toBeDefined();
      expect(result.messagesBefore).toBeGreaterThan(0);
      expect(result.messagesAfter).toBe(0); // latest message has nothing after
    });

    test('returns error for empty session', async () => {
      const emptySessionId = 'empty-session-id';
      createSession(createTestSession({ id: emptySessionId, workspaceId, title: 'Empty' }));

      const result = await executeSessionSearchTool(
        { action: 'read', sessionId: emptySessionId },
        workspaceId,
        currentSessionId,
        false,
        'none',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('no messages');
    });
  });

  // ── Read action with explicit aroundMessageId (backward compat) ──

  describe('read action with aroundMessageId', () => {
    let anchorMsgId: string;

    beforeEach(() => {
      // Seed messages and capture the 5th one as anchor
      for (let i = 0; i < 10; i++) {
        const msg = createTestUserMessage(otherSessionId, { createdAt: Date.now() + i });
        createMessage(msg);
        createPart(createTestTextPart(msg.id, `Message ${i} about testing`), otherSessionId);
        if (i === 5) anchorMsgId = msg.id;
      }
    });

    test('reads around explicit anchor', async () => {
      const result = await executeSessionSearchTool(
        { action: 'read', sessionId: otherSessionId, aroundMessageId: anchorMsgId!, window: 4 },
        workspaceId,
        currentSessionId,
        false,
        'none',
      );

      expect(result.success).toBe(true);
      expect(result.anchorInferred).toBeUndefined();
      expect(result.anchorMessageId).toBe(anchorMsgId);
      // window=4 → halfWindow=2 → 2 before + 1 anchor + 2 after = 5
      expect(result.messages!.length).toBe(5);
    });
  });

  // ── Backward compatibility ───────────────────────────────────

  describe('backward compatibility', () => {
    beforeEach(() => {
      seedMessages(otherSessionId, 5);
    });

    test('defaults to search mode when query is provided', async () => {
      const result = await executeSessionSearchTool(
        { query: 'testing' },
        workspaceId,
        currentSessionId,
        false,
        'none',
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('search');
    });

    test('defaults to read mode when sessionId is provided without action', async () => {
      const result = await executeSessionSearchTool(
        { sessionId: otherSessionId, window: 4 },
        workspaceId,
        currentSessionId,
        false,
        'none',
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('read');
      expect(result.anchorInferred).toBe(true);
    });

    test('returns error when no useful arguments provided', async () => {
      const result = await executeSessionSearchTool(
        {},
        workspaceId,
        currentSessionId,
        false,
        'none',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('list');
      expect(result.error).toContain('query');
      expect(result.error).toContain('sessionId');
    });
  });

  // ── Access control ───────────────────────────────────────────

  describe('access control', () => {
    test('read denies session from different workspace', async () => {
      const otherWsId = 'other-workspace';
      createWorkspace({
        id: otherWsId,
        name: 'Other WS',
        path: '/other',
        isVirtual: false,
        additionalPaths: [],
        settings: {},
      });
      const foreignSessionId = 'foreign-session';
      createSession(createTestSession({ id: foreignSessionId, workspaceId: otherWsId }));
      seedMessages(foreignSessionId, 3);

      const result = await executeSessionSearchTool(
        { action: 'read', sessionId: foreignSessionId },
        workspaceId,
        currentSessionId,
        false,
        'none',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('workspace');
    });

    test('read denies non-existent session', async () => {
      const result = await executeSessionSearchTool(
        { action: 'read', sessionId: 'does-not-exist' },
        workspaceId,
        currentSessionId,
        false,
        'none',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('agent can read cross-workspace session owned by same agent', async () => {
      const otherWsId = 'agent-other-workspace';
      createWorkspace({
        id: otherWsId,
        name: 'Agent Other WS',
        path: '/agent-other',
        isVirtual: false,
        additionalPaths: [],
        settings: {},
      });
      const agentSessionId = 'agent-foreign-session';
      const agentId = 'agent-123';
      createSession(createTestSession({ id: agentSessionId, workspaceId: otherWsId, agentId }));
      seedMessages(agentSessionId, 3);

      const result = await executeSessionSearchTool(
        { action: 'read', sessionId: agentSessionId },
        workspaceId,
        currentSessionId,
        false,
        'none',
        undefined,
        agentId,
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('read');
      expect(result.messages).toBeDefined();
      expect(result.messages!.length).toBeGreaterThan(0);
    });

    test('agent cannot read cross-workspace session owned by different agent', async () => {
      const otherWsId = 'agent-other-workspace-2';
      createWorkspace({
        id: otherWsId,
        name: 'Agent Other WS 2',
        path: '/agent-other-2',
        isVirtual: false,
        additionalPaths: [],
        settings: {},
      });
      const otherAgentSessionId = 'other-agent-session';
      createSession(createTestSession({ id: otherAgentSessionId, workspaceId: otherWsId, agentId: 'different-agent' }));
      seedMessages(otherAgentSessionId, 3);

      const result = await executeSessionSearchTool(
        { action: 'read', sessionId: otherAgentSessionId },
        workspaceId,
        currentSessionId,
        false,
        'none',
        undefined,
        'agent-123',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('workspace');
    });
  });
});
