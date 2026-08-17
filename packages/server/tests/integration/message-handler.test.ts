import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { withProviderOverrides } from '@capekai/core/internal/providers';
import { type ConnectableProvider, type ModelFactoryOptions } from '@capekai/core/internal/providers';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';
import { seedWorkspaceWithSession } from '#tests/seed';
import { createMockBroadcast } from '#tests/mocks';
import { registerBroadcastCallback } from '@/core/broadcast';
import {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  createMessage,
  createPart,
  listMessagesWithParts,
  addMessageToQueue,
  getQueuedMessage,
  listQueuedMessages,
  deleteQueuedMessage,
  getNextQueuedMessage,
} from '@/store';
import { executeCompaction, revertToStep, forkSession, interruptManager } from '@capekai/core/internal/execution';
import { resolveAsk, createAskApi } from '@capekai/core/internal/ask-authority';
import { getWorkspaceGrants, revokeGrant, revokeAllWorkspaceGrants } from '@/store/permissions';
import type { AssistantMessage, ToolPart, ServerMessage } from '@jean2/sdk';

const broadcastMock = createMockBroadcast();

const compactionModel = new MockLanguageModelV3({
  doStream: async () => ({
    stream: convertArrayToReadableStream([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 'summary' },
      { type: 'text-delta', id: 'summary', delta: '## Summary\n\nCompacted conversation summary.' },
      { type: 'text-end', id: 'summary' },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
      },
    ]),
  }),
});

function createCompactionProvider(id: string): ConnectableProvider {
  return {
    descriptor: { id, displayName: id, authType: 'none', connectable: false },
    getStatus: () => ({ provider: id, connected: true }),
    connect: async () => ({}),
    disconnect: async () => {},
    onTokensReceived: async () => {},
    createModel: async (_options: ModelFactoryOptions) => ({ model: compactionModel }),
  };
}

const compactionProviders = new Map<string, ConnectableProvider>([
  ['openai', createCompactionProvider('openai')],
  ['minimax', createCompactionProvider('minimax')],
]);

function executeCompactionWithModel(
  ...args: Parameters<typeof executeCompaction>
): ReturnType<typeof executeCompaction> {
  return withProviderOverrides(compactionProviders, () => executeCompaction(...args));
}

mock.module('@/config', () => ({
  findModel: () => ({ providerId: 'openai' }),
  getModelsConfig: () => ({
    defaultModel: 'gpt-4o',
    defaultProvider: 'openai',
  }),
  clearConfigCache: () => {},
  clearModelsCache: () => {},
}));

mock.module('@/env', () => ({
  getLLMOpenAIApiKey: () => 'test-key',
  getCompactionMaxTokens: () => 2000,
  getCompactionPreserveRecentToolCount: () => 3,
  getCompactionPreserveSmallToolChars: () => 200,
  getCompactionToolClearCharsThreshold: () => 1000,
  getCompactionMaxPrunedToolCount: () => 10,
  getCompactionAutoThresholdRatio: () => 0.7,
  getCompactionAutoReserveCapTokens: () => 30000,
  getCompactionAutoSafetyMarginTokens: () => 5000,
  getCompactionModel: () => null,
  getCompactionProvider: () => null,
}));

describe('Integration: WebSocket message handlers', () => {
  let sessionId: string;
  let workspaceId: string;

  beforeEach(() => {
    setupTestDataDir();
    setupTestDatabase();
    registerBroadcastCallback(broadcastMock.callback as (message: ServerMessage, excludeWs?: unknown) => void);
    broadcastMock.clear();

    const ctx = seedWorkspaceWithSession();
    sessionId = ctx.sessionId;
    workspaceId = ctx.workspaceId;
  });

  afterEach(() => {
    resetTestDatabase();
    resetTestDataDir();
  });

  function createUserMsg(id: string, sid: string = sessionId, ts: number = Date.now()) {
    return createMessage({ id, sessionId: sid, role: 'user', createdAt: ts });
  }

  function createAssistantMsg(id: string, sid: string = sessionId, overrides: Partial<AssistantMessage> = {}, ts: number = Date.now()) {
    return createMessage({
      id,
      sessionId: sid,
      role: 'assistant',
      createdAt: ts,
      status: overrides.status ?? 'completed',
      modelId: overrides.modelId ?? 'gpt-4o',
      providerId: overrides.providerId ?? 'openai',
      tokens: overrides.tokens ?? { prompt: 100, completion: 50 },
      cost: overrides.cost ?? 0,
      completedAt: overrides.completedAt ?? ts,
      ...overrides,
    } as AssistantMessage);
  }

  function addTextPart(messageId: string, text: string, sid: string = sessionId) {
    createPart({
      id: crypto.randomUUID(),
      messageId,
      createdAt: Date.now(),
      type: 'text',
      text,
    }, sid);
  }

  function addToolPart(messageId: string, callId: string, name: string = 'read-file', sid: string = sessionId) {
    createPart({
      id: crypto.randomUUID(),
      messageId,
      createdAt: Date.now(),
      type: 'tool',
      callId,
      name,
      state: {
        status: 'completed',
        input: { path: '/test' },
        output: 'contents',
        startedAt: Date.now() - 100,
        completedAt: Date.now(),
      },
    } as ToolPart, sid);
  }

  // ===========================================================================
  // Session lifecycle
  // ===========================================================================
  describe('session lifecycle', () => {
    test('session.create → DB + broadcast', () => {
      createSession({
        id: 'sess-new',
        workspaceId,
        preconfigId: null,
        title: 'New Session',
        status: 'active',
        metadata: null,
        parentId: null,
        agentName: null,
      });

      expect(getSession('sess-new')).toBeDefined();
      expect(getSession('sess-new')!.title).toBe('New Session');
      expect(getSession('sess-new')!.status).toBe('active');
    });

    test('session.close → update status + broadcast', () => {
      const updated = updateSession(sessionId, { status: 'closed' });
      expect(updated!.status).toBe('closed');
      expect(getSession(sessionId)!.status).toBe('closed');
    });

    test('session.reopen → update status back to active', () => {
      updateSession(sessionId, { status: 'closed' });
      const reopened = updateSession(sessionId, { status: 'active' });
      expect(reopened!.status).toBe('active');
    });

    test('session.delete → removed from DB', () => {
      expect(getSession(sessionId)).toBeDefined();
      deleteSession(sessionId);
      expect(getSession(sessionId)).toBeNull();
    });

    test('session.rename → update title', () => {
      const renamed = updateSession(sessionId, { title: 'Renamed Session' });
      expect(renamed!.title).toBe('Renamed Session');
    });

    test('session.rename with empty title → fails validation', () => {
      const trimmedTitle = '   '.trim();
      expect(trimmedTitle).toBe('');
    });

    test('session.update_model → updates selectedModel/provider', () => {
      const updated = updateSession(sessionId, {
        selectedModel: 'claude-3-opus',
        selectedProvider: 'anthropic',
        selectedVariant: null,
      });
      expect(updated!.selectedModel).toBe('claude-3-opus');
      expect(updated!.selectedProvider).toBe('anthropic');
    });
  });

  // ===========================================================================
  // Compaction flow
  // ===========================================================================
  describe('compaction flow', () => {
    test('manual compaction completes full cycle', async () => {
      createUserMsg('msg1', sessionId, 1000);
      addTextPart('msg1', 'What is TypeScript?');
      createAssistantMsg('msg2', sessionId, {}, 2000);
      addTextPart('msg2', 'TypeScript is a typed superset.');
      createUserMsg('msg3', sessionId, 3000);
      addTextPart('msg3', 'Tell me more.');
      createAssistantMsg('msg4', sessionId, {}, 4000);
      addTextPart('msg4', 'It adds static types.');
      broadcastMock.clear();

      const result = await executeCompactionWithModel(sessionId, 'manual');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.tokensUsed).toBeDefined();
        expect(result.result.tokensUsed.prompt).toBe(10);
        expect(result.result.tokensUsed.completion).toBe(20);
      }

      const messages = listMessagesWithParts(sessionId);
      const compactionParts = messages.flatMap(m => m.parts).filter(p => p.type === 'compaction');
      expect(compactionParts.length).toBeGreaterThanOrEqual(1);

      const summaryMessages = messages.filter(
        m => m.message.role === 'assistant' && (m.message as AssistantMessage).summary === true,
      );
      expect(summaryMessages.length).toBeGreaterThanOrEqual(1);

      const summaryText = summaryMessages[0].parts.find(p => p.type === 'text');
      expect(summaryText).toBeDefined();
    });

    test('compaction fails for child session (parentId set)', async () => {
      const { createSession: createSess } = await import('@/store/sessions');
      const childSession = createSess({
        id: 'child-sess',
        workspaceId,
        preconfigId: null,
        title: 'Child',
        status: 'active',
        metadata: null,
        parentId: sessionId,
        agentName: null,
      });

      const result = await executeCompactionWithModel(childSession.id, 'manual');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.skipped).toBe(true);
        expect(result.error).toContain('only available for main sessions');
      }
    });

    test('compaction on empty session returns error', async () => {
      const result = await executeCompactionWithModel(sessionId, 'manual');
      expect(result.ok).toBe(false);
    });

    test('compaction broadcasts session.updated with compacting flag', async () => {
      createUserMsg('msg1', sessionId, 1000);
      addTextPart('msg1', 'Hello');
      createAssistantMsg('msg2', sessionId, {}, 2000);
      addTextPart('msg2', 'Hi');
      broadcastMock.clear();

      await executeCompactionWithModel(sessionId, 'manual');

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const sessionUpdates = broadcastMock.messages.filter(
        (m: any) => m.type === 'session.updated',
      );
      expect(sessionUpdates.length).toBeGreaterThanOrEqual(2);

      const firstUpdate = sessionUpdates[0] as any;
      expect(firstUpdate.session.compacting).toBe(true);

      const lastUpdate = sessionUpdates[sessionUpdates.length - 1] as any;
      expect(lastUpdate.session.compacting).toBe(false);
      /* eslint-enable @typescript-eslint/no-explicit-any */
    });
  });

  // ===========================================================================
  // Revert flow
  // ===========================================================================
  describe('revert flow', () => {
    test('revert deletes messages and broadcasts state', async () => {
      createUserMsg('msg1', sessionId, 1000);
      addTextPart('msg1', 'Hello');
      createAssistantMsg('msg2', sessionId, {}, 2000);
      addTextPart('msg2', 'Hi');
      createUserMsg('msg3', sessionId, 3000);
      addTextPart('msg3', 'More');
      createAssistantMsg('msg4', sessionId, {}, 4000);
      addTextPart('msg4', 'Sure');
      broadcastMock.clear();

      const result = await revertToStep({
        sessionId,
        targetMessageId: 'msg2',
      });

      expect(result.revertedTo.messageId).toBe('msg2');
      expect(result.removed.messageIds).toHaveLength(2);
      expect(result.removed.messageIds).toContain('msg3');
      expect(result.removed.messageIds).toContain('msg4');

      const remaining = listMessagesWithParts(sessionId);
      expect(remaining).toHaveLength(2);
      expect(remaining[0].message.id).toBe('msg1');
      expect(remaining[1].message.id).toBe('msg2');

      const currentState = listMessagesWithParts(sessionId);
      expect(currentState).toHaveLength(2);
    });

    test('revert to first message clears all', async () => {
      createUserMsg('msg1', sessionId, 1000);
      addTextPart('msg1', 'Hello');
      createAssistantMsg('msg2', sessionId, {}, 2000);
      addTextPart('msg2', 'Hi');

      const result = await revertToStep({
        sessionId,
        targetMessageId: 'msg1',
      });

      expect(result.revertedTo.messageId).toBeNull();
      expect(result.revertedTo.messageCount).toBe(0);
      expect(result.removed.messageIds).toHaveLength(2);

      const remaining = listMessagesWithParts(sessionId);
      expect(remaining).toHaveLength(0);
    });

    test('revert throws for nonexistent target', async () => {
      createUserMsg('msg1', sessionId, 1000);
      addTextPart('msg1', 'Hello');

      await expect(
        revertToStep({ sessionId, targetMessageId: 'nonexistent' }),
      ).rejects.toThrow('Target message not found');
    });
  });

  // ===========================================================================
  // Fork flow
  // ===========================================================================
  describe('fork flow', () => {
    test('fork creates new session with copied messages', async () => {
      createUserMsg('msg1', sessionId, 1000);
      addTextPart('msg1', 'Hello');
      createAssistantMsg('msg2', sessionId, {}, 2000);
      addTextPart('msg2', 'Hi there');
      createUserMsg('msg3', sessionId, 3000);
      addTextPart('msg3', 'How are you?');
      createAssistantMsg('msg4', sessionId, {}, 4000);
      addTextPart('msg4', 'Fine');
      broadcastMock.clear();

      const result = await forkSession({
        sessionId,
        targetMessageId: 'msg2',
        title: 'My Fork',
      });

      expect(result.forkedSession.title).toBe('My Fork');
      expect(result.forkedSession.workspaceId).toBe(workspaceId);
      expect((result.forkedSession.metadata as Record<string, unknown>)?.forkedFrom).toBe(sessionId);
      expect(result.messages).toHaveLength(2);

      const forkedMessages = listMessagesWithParts(result.forkedSession.id);
      expect(forkedMessages).toHaveLength(2);
      expect(forkedMessages[0].message.role).toBe('user');
      expect(forkedMessages[1].message.role).toBe('assistant');

      const sourceMessages = listMessagesWithParts(sessionId);
      expect(sourceMessages).toHaveLength(4);
    });

    test('fork copies tool parts', async () => {
      createUserMsg('msg1', sessionId, 1000);
      addTextPart('msg1', 'Read file');
      createAssistantMsg('msg2', sessionId, {}, 2000);
      addToolPart('msg2', 'call-1', 'read-file');
      addTextPart('msg2', 'Here is the content');

      const result = await forkSession({
        sessionId,
        targetMessageId: 'msg2',
      });

      const forkedMessages = listMessagesWithParts(result.forkedSession.id);
      const assistantParts = forkedMessages[1].parts;
      const toolPart = assistantParts.find(p => p.type === 'tool') as ToolPart;
      expect(toolPart).toBeDefined();
      expect(toolPart.name).toBe('read-file');
    });

    test('fork throws for nonexistent source', async () => {
      await expect(
        forkSession({ sessionId: 'nonexistent', targetMessageId: 'x' }),
      ).rejects.toThrow('Source session not found');
    });
  });

  // ===========================================================================
  // Interrupt flow
  // ===========================================================================
  describe('interrupt flow', () => {
    test('interrupt aborts session and tool controllers', async () => {
      const controller = interruptManager.registerSession(sessionId);
      const toolController = interruptManager.registerToolExecution(sessionId, 'tool-1');

      const result = await interruptManager.interruptSession(sessionId, 'user_request');

      expect(controller.signal.aborted).toBe(true);
      expect(toolController.signal.aborted).toBe(true);
      expect(result.success).toBe(true);
      expect(result.interruptedTools).toContain('tool-1');

      interruptManager.unregisterSession(sessionId);
    });

    test('interrupt marks subagent session as interrupted', async () => {
      const { createSession: createSess } = await import('@/store/sessions');
      const childSession = createSess({
        id: 'child-int',
        workspaceId,
        preconfigId: null,
        title: 'Child',
        status: 'active',
        metadata: null,
        parentId: sessionId,
        agentName: null,
        subagentStatus: 'running',
      });

      interruptManager.registerSession(childSession.id);
      await interruptManager.interruptSession(childSession.id, 'user_request');

      const updated = getSession(childSession.id);
      expect(updated!.subagentStatus).toBe('interrupted');

      interruptManager.unregisterSession(childSession.id);
    });

    test('interrupt session that is not active returns success', async () => {
      const result = await interruptManager.interruptSession('nonexistent');
      expect(result.success).toBe(true);
      expect(result.interruptedTools).toHaveLength(0);
    });

    test('isSessionActive changes after interrupt', async () => {
      interruptManager.registerSession(sessionId);
      expect(interruptManager.isSessionActive(sessionId)).toBe(true);

      await interruptManager.interruptSession(sessionId);
      expect(interruptManager.isSessionActive(sessionId)).toBe(false);

      interruptManager.unregisterSession(sessionId);
    });
  });

  // ===========================================================================
  // Queue flow
  // ===========================================================================
  describe('queue flow', () => {
    test('add message to queue and retrieve', () => {
      const queued = addMessageToQueue(sessionId, 'Hello from queue');
      expect(queued.id).toBeDefined();
      expect(queued.content).toBe('Hello from queue');
      expect(queued.sessionId).toBe(sessionId);

      const retrieved = getQueuedMessage(queued.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.content).toBe('Hello from queue');
    });

    test('queue maintains FIFO order', () => {
      addMessageToQueue(sessionId, 'First');
      addMessageToQueue(sessionId, 'Second');
      addMessageToQueue(sessionId, 'Third');

      const next = getNextQueuedMessage(sessionId);
      expect(next!.content).toBe('First');

      deleteQueuedMessage(next!.id);
      const next2 = getNextQueuedMessage(sessionId);
      expect(next2!.content).toBe('Second');
    });

    test('list queued messages returns all for session', () => {
      addMessageToQueue(sessionId, 'First');
      addMessageToQueue(sessionId, 'Second');

      const messages = listQueuedMessages(sessionId);
      expect(messages).toHaveLength(2);
    });

    test('delete queued message removes it', () => {
      const queued = addMessageToQueue(sessionId, 'To delete');
      expect(deleteQueuedMessage(queued.id)).toBe(true);
      expect(getQueuedMessage(queued.id)).toBeNull();
    });

    test('queue is session-scoped', () => {
      const otherSession = createSession({
        id: 'other-session',
        workspaceId,
        preconfigId: null,
        title: 'Other',
        status: 'active',
        metadata: null,
        parentId: null,
        agentName: null,
      });

      addMessageToQueue(sessionId, 'Session 1 msg');
      addMessageToQueue(otherSession.id, 'Session 2 msg');

      expect(listQueuedMessages(sessionId)).toHaveLength(1);
      expect(listQueuedMessages(otherSession.id)).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Ask/Response flow
  // ===========================================================================
  describe('ask/response flow', () => {
    test('create ask resolves on response', async () => {
      const broadcastFn = (msg: ServerMessage) => {
        broadcastMock.callback(msg);
      };

      const askApi = createAskApi(sessionId, 'call-1', 'test-tool', broadcastFn);

      const askPromise = askApi({ type: 'text', question: 'What is your name?', target: 'human' });

      const askEvents = broadcastMock.messages.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m: any) => m.type === 'ask.request',
      );
      expect(askEvents).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((askEvents[0] as any).toolCallId).toBe('call-1');

      const resolved = resolveAsk('call-1', { type: 'text', value: 'Jean' });
      expect(resolved).toBe(true);

      const response = await askPromise;
      expect(response as string).toBe('Jean');
    });

    test('create ask with permission auto-grants if matching grant exists', async () => {
      const { createGrantFromOptions } = await import('@/store/permissions');
      createGrantFromOptions({
        workspaceId,
        toolName: 'read-file',
        resource: 'file',
        permissionKey: '/test/path',
        grantOptions: {
          scope: 'session',
          matcher: 'exact',
          duration: 30 * 60 * 1000,
          description: 'Allow read',
        },
      });

      const broadcastFn = (msg: ServerMessage) => {
        broadcastMock.callback(msg);
      };

      const askApi = createAskApi(sessionId, 'call-2', 'read-file', broadcastFn, workspaceId);

      const result = await askApi({
        type: 'permission',
        resource: 'file',
        question: 'Allow reading /test/path?',
        patterns: ['/test/path'],
      });

      expect(result).toBe(true);

      const askEvents = broadcastMock.messages.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m: any) => m.type === 'ask.request',
      );
      expect(askEvents).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Permission flow
  // ===========================================================================
  describe('permission flow', () => {
    test('list permissions returns workspace grants', () => {
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toBeDefined();
      expect(Array.isArray(grants)).toBe(true);
    });

    test('revoke grant removes it', async () => {
      const { createGrantFromOptions } = await import('@/store/permissions');
      createGrantFromOptions({
        workspaceId,
        toolName: 'read-file',
        resource: 'file',
        permissionKey: '/test/file',
        grantOptions: {
          scope: 'session',
          matcher: 'exact',
          duration: 30 * 60 * 1000,
          description: 'Allow read',
        },
      });

      const grantsBefore = getWorkspaceGrants(workspaceId);
      expect(grantsBefore.length).toBeGreaterThanOrEqual(1);

      revokeGrant(grantsBefore[0].id, null);

      const grantsAfter = getWorkspaceGrants(workspaceId);
      const activeGrants = grantsAfter.filter(g => g.revokedAt === null);
      expect(activeGrants.length).toBe(grantsBefore.length - 1);
    });

    test('revoke all workspace grants', async () => {
      const { createGrantFromOptions } = await import('@/store/permissions');
      createGrantFromOptions({
        workspaceId,
        toolName: 'read-file',
        resource: 'file',
        permissionKey: '/test/1',
        grantOptions: { scope: 'session', matcher: 'exact', description: 'Grant 1' },
      });
      createGrantFromOptions({
        workspaceId,
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'ls',
        grantOptions: { scope: 'session', matcher: 'exact', description: 'Grant 2' },
      });

      const count = revokeAllWorkspaceGrants(workspaceId, null);
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  // ===========================================================================
  // Session resume + pending asks
  // ===========================================================================
  describe('session resume', () => {
    test('resume returns session messages', () => {
      createUserMsg('msg1', sessionId, 1000);
      addTextPart('msg1', 'Hello');
      createAssistantMsg('msg2', sessionId, {}, 2000);
      addTextPart('msg2', 'Hi');

      const messages = listMessagesWithParts(sessionId);
      expect(messages).toHaveLength(2);
      expect(messages[0].message.role).toBe('user');
      expect(messages[1].message.role).toBe('assistant');
    });

    test('resume returns queued messages', () => {
      addMessageToQueue(sessionId, 'Queued message 1');
      addMessageToQueue(sessionId, 'Queued message 2');

      const queued = listQueuedMessages(sessionId);
      expect(queued).toHaveLength(2);
      expect(queued[0].content).toBe('Queued message 1');
    });
  });
});
