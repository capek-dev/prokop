import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import {
  createMessage,
  getMessage,
  updateMessage,
  listMessages,
  deleteMessage,
  deleteMessages,
  createPart,
  getPart,
  updatePart,
  getPartsByMessage,
  getPartsBySession,
  getMessageWithParts,
  listMessagesWithParts,
  createToolPartPending,
  transitionToolToRunning,
  transitionToolToCompleted,
  transitionToolToError,
  transitionToolToRunningByCallId,
  transitionToolToInterrupted,
  findOrphanedToolCalls,
  reconcileOrphanedToolCalls,
  reconcileAllOrphanedToolCalls,
  findOrphanedCompactionTriggers,
  buildEffectiveContextHistory,
  listMessagesForSession,
  getToolPartByCallId,
  persistStreamingPartSnapshot,
  persistStreamingPartSnapshots,
  syncMessageFts,
} from '@/store/messages';
import { createSession } from '@/store/sessions';
import { getDatabase } from '@/store';
import { revertToStep, forkSession } from '@capekai/core/compat/jean2';
import { createTestSession } from '#tests/factories';
import type { AssistantMessage, Part, ToolPart } from '@jean2/sdk';

function makeSession(overrides: { id: string; workspaceId: string; title: string; status: 'active' | 'closed' }) {
  const { createdAt: _c, updatedAt: _u, ...defaults } = createTestSession(overrides);
  return defaults;
}

describe('messages store', () => {
  let sessionId: string;

  beforeEach(() => {
    const _ctx = setupTestDatabase();
    const result = seedWorkspaceWithSession();
    sessionId = result.sessionId;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  // Helper to create user message
  function createUserMsg(id: string, ts: number = Date.now()) {
    return createMessage({
      id,
      sessionId,
      role: 'user',
      createdAt: ts,
    });
  }

  // Helper to create assistant message
  function createAssistantMsg(id: string, overrides: Partial<AssistantMessage> = {}, ts: number = Date.now()) {
    return createMessage({
      id,
      sessionId,
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

  // ===========================================================================
  // Message CRUD
  // ===========================================================================

  describe('message CRUD', () => {
    test('createMessage inserts a user message and returns it', () => {
      const msg = createUserMsg('msg1');

      expect(msg.id).toBe('msg1');
      expect(msg.role).toBe('user');
      expect(msg.sessionId).toBe(sessionId);
    });

    test('createMessage inserts an assistant message with all fields', () => {
      const msg = createAssistantMsg('msg2', {
        status: 'completed',
        modelId: 'gpt-4o',
        providerId: 'openai',
        tokens: { prompt: 200, completion: 100 },
        cost: 0.005,
      });

      expect(msg.id).toBe('msg2');
      expect(msg.role).toBe('assistant');
      if (msg.role === 'assistant') {
        expect(msg.status).toBe('completed');
        expect(msg.modelId).toBe('gpt-4o');
        expect(msg.providerId).toBe('openai');
        expect(msg.tokens).toEqual({ prompt: 200, completion: 100 });
        expect(msg.cost).toBe(0.005);
      }
    });

    test('getMessage returns message by id', () => {
      createUserMsg('msg1');

      const retrieved = getMessage('msg1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('msg1');
      expect(retrieved!.role).toBe('user');
    });

    test('getMessage returns null for non-existent', () => {
      expect(getMessage('nonexistent')).toBeNull();
    });

    test('updateMessage patches assistant message fields', () => {
      createAssistantMsg('msg1', { status: 'streaming' });

      const updated = updateMessage('msg1', {
        status: 'completed',
        cost: 0.01,
      } as Partial<AssistantMessage>);

      expect(updated).not.toBeNull();
      if (updated && updated.role === 'assistant') {
        expect(updated.status).toBe('completed');
        expect(updated.cost).toBe(0.01);
      }
    });

    test('updateMessage returns null for non-existent', () => {
      expect(updateMessage('nonexistent', {})).toBeNull();
    });

    test('listMessages returns messages ordered by created_at', () => {
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);

      const messages = listMessages(sessionId);
      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe('msg1');
      expect(messages[1].id).toBe('msg2');
    });

    test('listMessages returns empty for session with no messages', () => {
      expect(listMessages(sessionId)).toHaveLength(0);
    });

    test('deleteMessage removes message and its parts', () => {
      createUserMsg('msg1');
      createPart({
        id: 'p1',
        messageId: 'msg1',
        createdAt: Date.now(),
        type: 'text',
        text: 'hello',
      } as Part, sessionId);

      expect(deleteMessage('msg1')).toBe(true);
      expect(getMessage('msg1')).toBeNull();
      expect(getPart('p1')).toBeNull();
    });

    test('deleteMessage returns false for non-existent', () => {
      expect(deleteMessage('nonexistent')).toBe(false);
    });

    test('deleteMessages removes all messages for a session', () => {
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);

      const count = deleteMessages(sessionId);
      expect(count).toBe(2);
      expect(listMessages(sessionId)).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Part CRUD
  // ===========================================================================

  describe('part CRUD', () => {
    test('createPart and getPart roundtrip', () => {
      createUserMsg('msg1');
      const part = createPart({
        id: 'p1',
        messageId: 'msg1',
        createdAt: Date.now(),
        type: 'text',
        text: 'hello world',
      } as Part, sessionId);

      expect(part.type).toBe('text');

      const retrieved = getPart('p1');
      expect(retrieved).not.toBeNull();
      expect((retrieved as unknown as Record<string, unknown>).text).toBe('hello world');
    });

    test('updatePart merges updates', () => {
      createUserMsg('msg1');
      createPart({
        id: 'p1',
        messageId: 'msg1',
        createdAt: Date.now(),
        type: 'text',
        text: 'hello',
      } as Part, sessionId);

      const updated = updatePart('p1', { text: 'hello world' });
      expect(updated).not.toBeNull();
      expect((updated as unknown as Record<string, unknown>).text).toBe('hello world');
    });

    test('updatePart returns null for non-existent', () => {
      expect(updatePart('nonexistent', { text: 'x' })).toBeNull();
    });

    test('getPartsByMessage returns parts in order', () => {
      createUserMsg('msg1');
      createPart({
        id: 'p1',
        messageId: 'msg1',
        createdAt: 1000,
        type: 'text',
        text: 'a',
      } as Part, sessionId);
      createPart({
        id: 'p2',
        messageId: 'msg1',
        createdAt: 2000,
        type: 'text',
        text: 'b',
      } as Part, sessionId);

      const parts = getPartsByMessage('msg1');
      expect(parts).toHaveLength(2);
      expect(parts[0].id).toBe('p1');
      expect(parts[1].id).toBe('p2');
    });

    test('getPartsByMessage returns empty for message with no parts', () => {
      createUserMsg('msg1');
      expect(getPartsByMessage('msg1')).toHaveLength(0);
    });

    test('getPartsBySession returns all parts across messages', () => {
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);
      createPart({
        id: 'p1',
        messageId: 'msg1',
        createdAt: 1000,
        type: 'text',
        text: 'a',
      } as Part, sessionId);
      createPart({
        id: 'p2',
        messageId: 'msg2',
        createdAt: 2000,
        type: 'text',
        text: 'b',
      } as Part, sessionId);

      const parts = getPartsBySession(sessionId);
      expect(parts).toHaveLength(2);
    });
  });

  // ===========================================================================
  // Combined View
  // ===========================================================================

  describe('combined view', () => {
    test('getMessageWithParts returns message with its parts', () => {
      createUserMsg('msg1');
      createPart({
        id: 'p1',
        messageId: 'msg1',
        createdAt: Date.now(),
        type: 'text',
        text: 'hello',
      } as Part, sessionId);

      const result = getMessageWithParts('msg1');
      expect(result).not.toBeNull();
      expect(result!.message.id).toBe('msg1');
      expect(result!.parts).toHaveLength(1);
    });

    test('getMessageWithParts returns null for non-existent', () => {
      expect(getMessageWithParts('nonexistent')).toBeNull();
    });

    test('listMessagesWithParts returns all messages with parts', () => {
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);
      createPart({
        id: 'p1',
        messageId: 'msg1',
        createdAt: 1000,
        type: 'text',
        text: 'hello',
      } as Part, sessionId);

      const result = listMessagesWithParts(sessionId);
      expect(result).toHaveLength(2);
      expect(result[0].message.id).toBe('msg1');
      expect(result[0].parts).toHaveLength(1);
      expect(result[1].message.id).toBe('msg2');
      expect(result[1].parts).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Tool State Transitions
  // ===========================================================================

  describe('tool state transitions', () => {
    test('createToolPartPending creates pending tool', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', { path: '/test' }, sessionId);

      expect(tool.type).toBe('tool');
      expect(tool.state.status).toBe('pending');
      expect(tool.name).toBe('read-file');
      expect(tool.callId).toBe('call-1');
      expect(tool.state.input).toEqual({ path: '/test' });
    });

    test('transitionToolToRunning updates status to running', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);

      const running = transitionToolToRunning(tool.id);
      expect(running).not.toBeNull();
      expect(running!.state.status).toBe('running');
      expect(running!.state.input).toEqual({});
      if (running!.state.status === 'running') {
        expect(running!.state.startedAt).toBeDefined();
      }
    });

    test('transitionToolToRunning with childSessionId', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const tool = createToolPartPending('msg1', 'call-1', 'subagent', {}, sessionId);

      const running = transitionToolToRunning(tool.id, 'child-session-1');
      expect(running!.state.status).toBe('running');
      if (running!.state.status === 'running') {
        expect(running!.state.childSessionId).toBe('child-session-1');
      }
    });

    test('transitionToolToRunning returns null if not pending', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);
      transitionToolToRunning(tool.id);

      // Already running, can't transition again
      expect(transitionToolToRunning(tool.id)).toBeNull();
    });

    test('transitionToolToCompleted sets output', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);
      transitionToolToRunning(tool.id);

      const completed = transitionToolToCompleted(tool.id, 'file contents');
      expect(completed).not.toBeNull();
      expect(completed!.state.status).toBe('completed');
      if (completed!.state.status === 'completed') {
        expect(completed!.state.output).toBe('file contents');
        expect(completed!.state.completedAt).toBeDefined();
      }
    });

    test('transitionToolToCompleted returns null if not running', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);

      // Still pending, can't complete
      expect(transitionToolToCompleted(tool.id, 'output')).toBeNull();
    });

    test('transitionToolToError sets error from any state', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);

      const errored = transitionToolToError(tool.id, 'file not found');
      expect(errored).not.toBeNull();
      expect(errored!.state.status).toBe('error');
      if (errored!.state.status === 'error') {
        expect(errored!.state.error).toBe('file not found');
        expect(errored!.state.failedAt).toBeDefined();
      }
    });

    test('transitionToolToError from running state preserves startedAt', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);
      const running = transitionToolToRunning(tool.id);
      const startedAt = running!.state.status === 'running' ? running!.state.startedAt : 0;

      const errored = transitionToolToError(tool.id, 'timeout');
      if (errored!.state.status === 'error') {
        expect(errored!.state.startedAt).toBe(startedAt);
      }
    });

    test('cannot transition from completed to running', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);
      transitionToolToRunning(tool.id);
      transitionToolToCompleted(tool.id, 'done');

      expect(transitionToolToRunning(tool.id)).toBeNull();
    });

    test('cannot transition from completed to completed', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);
      transitionToolToRunning(tool.id);
      transitionToolToCompleted(tool.id, 'done');

      expect(transitionToolToCompleted(tool.id, 'other')).toBeNull();
    });

    test('transitionToolToRunningByCallId finds tool by call ID', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);

      const running = transitionToolToRunningByCallId(sessionId, 'call-1');
      expect(running).not.toBeNull();
      expect(running!.state.status).toBe('running');
    });

    test('transitionToolToRunningByCallId returns null for unknown call ID', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);

      expect(transitionToolToRunningByCallId(sessionId, 'unknown')).toBeNull();
    });

    test('transitionToolToRunningByCallId with childSessionId', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      createToolPartPending('msg1', 'call-1', 'subagent', {}, sessionId);

      const running = transitionToolToRunningByCallId(sessionId, 'call-1', 'child-1');
      if (running!.state.status === 'running') {
        expect(running!.state.childSessionId).toBe('child-1');
      }
    });

    test('transitionToolToInterrupted sets interrupted status', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);
      transitionToolToRunning(tool.id);

      const interrupted = transitionToolToInterrupted(tool.id, 'user_request');
      expect(interrupted).not.toBeNull();
      if (interrupted!.state.status === 'interrupted') {
        expect(interrupted!.state.reason).toBe('user_request');
        expect(interrupted!.state.interruptedAt).toBeDefined();
      }
    });

    test('transitionToolToInterrupted from pending state', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);

      const interrupted = transitionToolToInterrupted(tool.id, 'timeout');
      expect(interrupted).not.toBeNull();
      expect(interrupted!.state.status).toBe('interrupted');
    });
  });

  // ===========================================================================
  // Orphaned Tool Call Recovery
  // ===========================================================================

  describe('orphaned tool call recovery', () => {
    test('findOrphanedToolCalls finds pending tools', () => {
      createAssistantMsg('msg1', { status: 'completed' });
      createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);

      const orphaned = findOrphanedToolCalls(sessionId);
      expect(orphaned).toHaveLength(1);
      expect(orphaned[0].name).toBe('read-file');
    });

    test('findOrphanedToolCalls finds running tools', () => {
      createAssistantMsg('msg1', { status: 'completed' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);
      transitionToolToRunning(tool.id);

      const orphaned = findOrphanedToolCalls(sessionId);
      expect(orphaned).toHaveLength(1);
    });

    test('findOrphanedToolCalls excludes completed tools', () => {
      createAssistantMsg('msg1', { status: 'completed' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);
      transitionToolToRunning(tool.id);
      transitionToolToCompleted(tool.id, 'done');

      expect(findOrphanedToolCalls(sessionId)).toHaveLength(0);
    });

    test('findOrphanedToolCalls excludes errored tools', () => {
      createAssistantMsg('msg1', { status: 'completed' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);
      transitionToolToError(tool.id, 'fail');

      expect(findOrphanedToolCalls(sessionId)).toHaveLength(0);
    });

    test('reconcileOrphanedToolCalls marks them as interrupted', () => {
      createAssistantMsg('msg1', { status: 'completed' });
      createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);

      const count = reconcileOrphanedToolCalls(sessionId);
      expect(count).toBe(1);
      expect(findOrphanedToolCalls(sessionId)).toHaveLength(0);
    });

    test('reconcileAllOrphanedToolCalls reconciles across sessions', () => {
      // Create two sessions with orphaned tools
      createAssistantMsg('msg1', { status: 'completed' });
      createToolPartPending('msg1', 'call-1', 'read-file', {}, sessionId);

      // Create another session
      createSession(makeSession({ id: 'sess2', workspaceId: 'ws1', title: 'Session 2', status: 'active' }));
      createMessage({ id: 'msg2', sessionId: 'sess2', role: 'assistant', createdAt: Date.now(), status: 'completed', modelId: 'gpt-4o', providerId: 'openai', tokens: { prompt: 0, completion: 0 }, cost: 0 } as AssistantMessage);
      createToolPartPending('msg2', 'call-2', 'shell', { command: 'ls' }, 'sess2');

      const total = reconcileAllOrphanedToolCalls();
      expect(total).toBe(2);
    });
  });

  // ===========================================================================
  // Compaction-Aware Context Building
  // ===========================================================================

  describe('buildEffectiveContextHistory', () => {
    test('returns all messages when no compaction', () => {
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);

      const result = buildEffectiveContextHistory(sessionId);
      expect(result.messages).toHaveLength(2);
      expect(result.hasCompaction).toBe(false);
      expect(result.latestCompactionBoundary).toBeNull();
    });

    test('returns messages from latest compaction boundary', () => {
      // Create: user1, assistant1, TRIGGER(compaction), SUMMARY, user2
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);

      // Trigger: user message with compaction part
      createUserMsg('trigger', 3000);
      createPart({
        id: 'cp1',
        messageId: 'trigger',
        createdAt: 3000,
        type: 'compaction',
        auto: true,
        overflow: false,
      } as Part, sessionId);

      // Summary: assistant message with summary=true, mode='compaction', parentId=trigger
      createAssistantMsg('summary', {
        summary: true,
        mode: 'compaction',
        parentId: 'trigger',
      } as Partial<AssistantMessage>, 4000);
      createPart({
        id: 'sp1',
        messageId: 'summary',
        createdAt: 4000,
        type: 'text',
        text: 'Summary of conversation...',
      } as Part, sessionId);

      // Post-compaction message
      createUserMsg('msg5', 5000);

      const result = buildEffectiveContextHistory(sessionId);
      expect(result.hasCompaction).toBe(true);
      expect(result.messages).toHaveLength(3); // trigger + summary + msg5
      expect(result.messages[0].message.id).toBe('trigger');
      expect(result.messages[1].message.id).toBe('summary');
      expect(result.messages[2].message.id).toBe('msg5');
      expect(result.latestCompactionBoundary).toBe('trigger');
    });

    test('uses latest compaction boundary when multiple exist', () => {
      // First compaction
      createUserMsg('trigger1', 1000);
      createPart({
        id: 'cp1',
        messageId: 'trigger1',
        createdAt: 1000,
        type: 'compaction',
        auto: true,
        overflow: false,
      } as Part, sessionId);
      createAssistantMsg('summary1', {
        summary: true,
        mode: 'compaction',
        parentId: 'trigger1',
      } as Partial<AssistantMessage>, 2000);
      createPart({
        id: 'sp1',
        messageId: 'summary1',
        createdAt: 2000,
        type: 'text',
        text: 'First summary',
      } as Part, sessionId);

      // Some messages
      createUserMsg('msg3', 3000);

      // Second compaction
      createUserMsg('trigger2', 4000);
      createPart({
        id: 'cp2',
        messageId: 'trigger2',
        createdAt: 4000,
        type: 'compaction',
        auto: true,
        overflow: false,
      } as Part, sessionId);
      createAssistantMsg('summary2', {
        summary: true,
        mode: 'compaction',
        parentId: 'trigger2',
      } as Partial<AssistantMessage>, 5000);
      createPart({
        id: 'sp2',
        messageId: 'summary2',
        createdAt: 5000,
        type: 'text',
        text: 'Second summary',
      } as Part, sessionId);

      // Post-second-compaction message
      createUserMsg('msg6', 6000);

      const result = buildEffectiveContextHistory(sessionId);
      expect(result.hasCompaction).toBe(true);
      expect(result.latestCompactionBoundary).toBe('trigger2');
      expect(result.messages).toHaveLength(3); // trigger2 + summary2 + msg6
    });

    test('returns empty for session with no messages', () => {
      const result = buildEffectiveContextHistory(sessionId);
      expect(result.messages).toHaveLength(0);
      expect(result.hasCompaction).toBe(false);
    });
  });

  // ===========================================================================
  // Orphaned Compaction Triggers
  // ===========================================================================

  describe('findOrphanedCompactionTriggers', () => {
    test('finds triggers without outcomes', () => {
      createUserMsg('trigger1', 1000);
      createPart({
        id: 'cp1',
        messageId: 'trigger1',
        createdAt: 1000,
        type: 'compaction',
        auto: true,
        overflow: false,
      } as Part, sessionId);

      const orphaned = findOrphanedCompactionTriggers(sessionId);
      expect(orphaned).toHaveLength(1);
      expect(orphaned[0].id).toBe('trigger1');
    });

    test('excludes triggers that have outcomes', () => {
      createUserMsg('trigger1', 1000);
      createPart({
        id: 'cp1',
        messageId: 'trigger1',
        createdAt: 1000,
        type: 'compaction',
        auto: true,
        overflow: false,
      } as Part, sessionId);

      // Create outcome (assistant message with parentId)
      createAssistantMsg('outcome1', {
        parentId: 'trigger1',
      } as Partial<AssistantMessage>, 2000);

      expect(findOrphanedCompactionTriggers(sessionId)).toHaveLength(0);
    });

    test('returns empty when no compaction parts exist', () => {
      createUserMsg('msg1', 1000);
      createPart({
        id: 'p1',
        messageId: 'msg1',
        createdAt: 1000,
        type: 'text',
        text: 'hello',
      } as Part, sessionId);

      expect(findOrphanedCompactionTriggers(sessionId)).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Optimized JOIN Queries (N+1 fix)
  // ===========================================================================

  describe('listMessagesWithParts optimized JOIN', () => {
    test('correctly groups multiple parts per message', () => {
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);
      createPart({ id: 'p1', messageId: 'msg1', createdAt: 100, type: 'text', text: 'first' } as Part, sessionId);
      createPart({ id: 'p2', messageId: 'msg1', createdAt: 200, type: 'text', text: 'second' } as Part, sessionId);
      createPart({ id: 'p3', messageId: 'msg1', createdAt: 300, type: 'reasoning', text: 'thinking' } as Part, sessionId);
      createPart({ id: 'p4', messageId: 'msg2', createdAt: 400, type: 'text', text: 'reply' } as Part, sessionId);

      const result = listMessagesWithParts(sessionId);
      expect(result).toHaveLength(2);

      expect(result[0].message.id).toBe('msg1');
      expect(result[0].parts).toHaveLength(3);
      expect(result[0].parts.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);

      expect(result[1].message.id).toBe('msg2');
      expect(result[1].parts).toHaveLength(1);
      expect(result[1].parts[0].id).toBe('p4');
    });

    test('handles messages with no parts (LEFT JOIN null)', () => {
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);
      createPart({ id: 'p1', messageId: 'msg1', createdAt: 100, type: 'text', text: 'only' } as Part, sessionId);

      const result = listMessagesWithParts(sessionId);
      expect(result).toHaveLength(2);
      expect(result[0].message.id).toBe('msg1');
      expect(result[0].parts).toHaveLength(1);
      expect(result[1].message.id).toBe('msg2');
      expect(result[1].parts).toHaveLength(0);
    });

    test('preserves message ordering by sequence (insertion order)', () => {
      // Messages are ordered by sequence (insertion order), not created_at.
      // This is the Phase 1 change: deterministic ordering via sequence column.
      createAssistantMsg('msg3', {}, 3000);
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);

      const result = listMessagesWithParts(sessionId);
      expect(result.map((r) => r.message.id)).toEqual(['msg3', 'msg1', 'msg2']);
    });

    test('preserves part ordering within each message', () => {
      createUserMsg('msg1', 1000);
      createPart({ id: 'p3', messageId: 'msg1', createdAt: 300, type: 'text', text: 'c' } as Part, sessionId);
      createPart({ id: 'p1', messageId: 'msg1', createdAt: 100, type: 'text', text: 'a' } as Part, sessionId);
      createPart({ id: 'p2', messageId: 'msg1', createdAt: 200, type: 'text', text: 'b' } as Part, sessionId);

      const result = listMessagesWithParts(sessionId);
      expect(result[0].parts.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    });

    test('correctly maps assistant message fields through JOIN', () => {
      createAssistantMsg('msg1', {
        status: 'completed',
        modelId: 'claude-4',
        providerId: 'anthropic',
        tokens: {
          prompt: 500,
          completion: 250,
          cacheRead: 300,
          cacheWrite: 50,
          noCache: 150,
        },
        cost: 0.02,
        agent: 'coder',
      }, 1000);

      const result = listMessagesWithParts(sessionId);
      expect(result).toHaveLength(1);
      const msg = result[0].message;
      if (msg.role === 'assistant') {
        expect(msg.status).toBe('completed');
        expect(msg.modelId).toBe('claude-4');
        expect(msg.providerId).toBe('anthropic');
        expect(msg.tokens).toEqual({
          prompt: 500,
          completion: 250,
          cacheRead: 300,
          cacheWrite: 50,
          noCache: 150,
        });
        expect(msg.cost).toBe(0.02);
        expect(msg.agent).toBe('coder');
      }
    });

    test('correctly deserializes tool part data through JOIN', () => {
      createAssistantMsg('msg1', { status: 'completed' });
      const tool = createToolPartPending('msg1', 'call-1', 'read-file', { path: '/test' }, sessionId);
      transitionToolToRunning(tool.id);
      transitionToolToCompleted(tool.id, { content: 'file data' });

      const result = listMessagesWithParts(sessionId);
      expect(result[0].parts).toHaveLength(1);
      const part = result[0].parts[0];
      expect(part.type).toBe('tool');
      if (part.type === 'tool') {
        expect(part.callId).toBe('call-1');
        expect(part.name).toBe('read-file');
        expect(part.state.status).toBe('completed');
        expect(part.state.input).toEqual({ path: '/test' });
        if (part.state.status === 'completed') {
          expect(part.state.output).toEqual({ content: 'file data' });
        }
      }
    });

    test('handles large dataset correctly (50 messages with 3 parts each)', () => {
      for (let i = 0; i < 50; i++) {
        createUserMsg(`msg-${i}`, i * 1000);
        for (let j = 0; j < 3; j++) {
          createPart({
            id: `p-${i}-${j}`,
            messageId: `msg-${i}`,
            createdAt: i * 1000 + j,
            type: 'text',
            text: `msg ${i} part ${j}`,
          } as Part, sessionId);
        }
      }

      const result = listMessagesWithParts(sessionId);
      expect(result).toHaveLength(50);
      for (let i = 0; i < 50; i++) {
        expect(result[i].message.id).toBe(`msg-${i}`);
        expect(result[i].parts).toHaveLength(3);
        expect(result[i].parts.map((p) => p.id)).toEqual([`p-${i}-0`, `p-${i}-1`, `p-${i}-2`]);
      }
    });

    test('returns empty array for session with no messages', () => {
      expect(listMessagesWithParts(sessionId)).toEqual([]);
    });

    test('does not leak parts from other sessions', () => {
      const otherSessionId = 'other-session-id';
      createSession(makeSession({ id: otherSessionId, workspaceId: 'ws1', title: 'Other', status: 'active' }));

      createUserMsg('msg1', 1000);
      createPart({ id: 'p1', messageId: 'msg1', createdAt: 100, type: 'text', text: 'mine' } as Part, sessionId);

      createMessage({ id: 'msg-other', sessionId: otherSessionId, role: 'user', createdAt: 2000 });
      createPart({ id: 'p-other', messageId: 'msg-other', createdAt: 200, type: 'text', text: 'not mine' } as Part, otherSessionId);

      const result = listMessagesWithParts(sessionId);
      expect(result).toHaveLength(1);
      expect(result[0].parts).toHaveLength(1);
      expect(result[0].parts[0].id).toBe('p1');
    });
  });

  describe('listMessagesForSession optimized (delegates to JOIN)', () => {
    test('returns same results as listMessagesWithParts', () => {
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);
      createPart({ id: 'p1', messageId: 'msg1', createdAt: 100, type: 'text', text: 'hello' } as Part, sessionId);
      createPart({ id: 'p2', messageId: 'msg2', createdAt: 200, type: 'text', text: 'world' } as Part, sessionId);

      const viaList = listMessagesWithParts(sessionId);
      const viaSession = listMessagesForSession(sessionId);

      expect(viaSession).toHaveLength(2);
      expect(viaSession[0].message.id).toBe('msg1');
      expect(viaSession[0].parts).toHaveLength(1);
      expect(viaSession[1].message.id).toBe('msg2');
      expect(viaSession[1].parts).toHaveLength(1);

      // Both should produce identical message IDs
      expect(viaList.map((r) => r.message.id)).toEqual(viaSession.map((r) => r.message.id));
      expect(viaList.map((r) => r.parts.map((p) => p.id)).flat()).toEqual(
        viaSession.map((r) => r.parts.map((p) => p.id)).flat(),
      );
    });

    test('handles empty session', () => {
      expect(listMessagesForSession(sessionId)).toEqual([]);
    });

    test('handles messages with mixed parts and no parts', () => {
      createUserMsg('msg1', 1000);
      createUserMsg('msg2', 2000);
      createUserMsg('msg3', 3000);
      createPart({ id: 'p1', messageId: 'msg1', createdAt: 100, type: 'text', text: 'a' } as Part, sessionId);
      createPart({ id: 'p2', messageId: 'msg1', createdAt: 200, type: 'text', text: 'b' } as Part, sessionId);
      // msg2 has no parts
      createPart({ id: 'p3', messageId: 'msg3', createdAt: 300, type: 'text', text: 'c' } as Part, sessionId);

      const result = listMessagesForSession(sessionId);
      expect(result).toHaveLength(3);
      expect(result[0].parts).toHaveLength(2);
      expect(result[1].parts).toHaveLength(0);
      expect(result[2].parts).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Phase 1: Message Sequencing
  // ===========================================================================

  describe('message sequencing (Phase 1)', () => {
    test('new messages receive increasing sequences within a session', () => {
      createUserMsg('msg1', 1000);
      createUserMsg('msg2', 2000);
      createUserMsg('msg3', 3000);

      const messages = listMessages(sessionId);
      expect(messages).toHaveLength(3);
      // All messages should have distinct sequence values, in order
      const db = getDatabase();
      const rows = db.query('SELECT id, sequence FROM messages WHERE session_id = ? ORDER BY sequence ASC').all(sessionId) as { id: string; sequence: number }[];
      expect(rows[0].sequence).toBe(1);
      expect(rows[1].sequence).toBe(2);
      expect(rows[2].sequence).toBe(3);
    });

    test('different sessions each start at sequence 1', () => {
      const otherSessionId = 'other-session-seq';
      createSession(makeSession({ id: otherSessionId, workspaceId: 'ws1', title: 'Other', status: 'active' }));

      createUserMsg('msg-a', 1000);
      createUserMsg('msg-b', 2000);

      createMessage({ id: 'msg-x', sessionId: otherSessionId, role: 'user', createdAt: 1000 });
      createMessage({ id: 'msg-y', sessionId: otherSessionId, role: 'user', createdAt: 2000 });

      const db = getDatabase();
      const seqA = (db.query('SELECT sequence FROM messages WHERE id = ?').get('msg-a') as { sequence: number }).sequence;
      const seqB = (db.query('SELECT sequence FROM messages WHERE id = ?').get('msg-b') as { sequence: number }).sequence;
      const seqX = (db.query('SELECT sequence FROM messages WHERE id = ?').get('msg-x') as { sequence: number }).sequence;
      const seqY = (db.query('SELECT sequence FROM messages WHERE id = ?').get('msg-y') as { sequence: number }).sequence;

      expect(seqA).toBe(1);
      expect(seqB).toBe(2);
      expect(seqX).toBe(1);
      expect(seqY).toBe(2);
    });

    test('same-millisecond messages retain insertion order via sequence', () => {
      const ts = Date.now();
      createUserMsg('msg1', ts);
      createUserMsg('msg2', ts);
      createUserMsg('msg3', ts);

      const messages = listMessages(sessionId);
      expect(messages.map((m) => m.id)).toEqual(['msg1', 'msg2', 'msg3']);
    });

    test('listMessages() orders by sequence', () => {
      // Insert out of timestamp order - sequence should still determine order
      createUserMsg('c', 3000);
      createUserMsg('a', 1000);
      createUserMsg('b', 2000);

      const messages = listMessages(sessionId);
      // Sequence order is insertion order: c=1, a=2, b=3
      expect(messages.map((m) => m.id)).toEqual(['c', 'a', 'b']);
    });

    test('listMessagesWithParts() orders messages by sequence and parts deterministically', () => {
      createUserMsg('msg1', 3000);
      createAssistantMsg('msg2', {}, 1000);
      // Parts with same timestamp should be ordered by id
      createPart({ id: 'p3', messageId: 'msg1', createdAt: 500, type: 'text', text: 'c' } as Part, sessionId);
      createPart({ id: 'p1', messageId: 'msg1', createdAt: 500, type: 'text', text: 'a' } as Part, sessionId);
      createPart({ id: 'p2', messageId: 'msg1', createdAt: 500, type: 'text', text: 'b' } as Part, sessionId);

      const result = listMessagesWithParts(sessionId);
      // Sequence: msg1=1, msg2=2
      expect(result.map((r) => r.message.id)).toEqual(['msg1', 'msg2']);
      // Parts ordered by (created_at, id)
      expect(result[0].parts.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    });

    test('revert leaves sequence gaps and the next insert remains monotonic', async () => {
      createUserMsg('msg1', 1000);
      createUserMsg('msg2', 2000);
      createUserMsg('msg3', 3000);
      createUserMsg('msg4', 4000);

      // Revert to msg2: delete msg3 and msg4
      await revertToStep({ sessionId, targetMessageId: 'msg2', keepTarget: true });

      // Next message should get MAX(sequence)+1 of surviving rows
      // After deleting msg3(seq=3) and msg4(seq=4), surviving MAX is 2, so msg5 gets seq=3
      createUserMsg('msg5', 5000);

      const messages = listMessages(sessionId);
      expect(messages.map((m) => m.id)).toEqual(['msg1', 'msg2', 'msg5']);

      const db = getDatabase();
      const seq5 = (db.query('SELECT sequence FROM messages WHERE id = ?').get('msg5') as { sequence: number }).sequence;
      expect(seq5).toBe(3); // MAX(1,2)+1 = 3
    });

    test('forked messages receive a new contiguous sequence in source order', async () => {
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);
      createUserMsg('msg3', 3000);

      const forkResult = await forkSession({ sessionId, targetMessageId: 'msg3' });
      const forkedSessionId = forkResult.forkedSession.id;

      const db = getDatabase();
      const rows = db.query('SELECT id, sequence FROM messages WHERE session_id = ? ORDER BY sequence ASC').all(forkedSessionId) as { id: string; sequence: number }[];
      expect(rows).toHaveLength(3);
      expect(rows[0].sequence).toBe(1);
      expect(rows[1].sequence).toBe(2);
      expect(rows[2].sequence).toBe(3);
    });

    test('unique index rejects duplicate sequence values within one session', () => {
      // First create a message through normal API (gets sequence=1)
      createUserMsg('msg1', 1000);

      const db = getDatabase();
      // Manually insert a message with a duplicate sequence
      // The unique index should prevent this
      expect(() => {
        db.run(
          `INSERT INTO messages (id, session_id, sequence, role, created_at) VALUES (?, ?, ?, ?, ?)`,
          ['dup-msg', sessionId, 1, 'user', 9999],
        );
      }).toThrow();
    });

    test('the same sequence value is valid in two different sessions', () => {
      const otherSessionId = 'other-session-dup';
      createSession(makeSession({ id: otherSessionId, workspaceId: 'ws1', title: 'Other', status: 'active' }));

      createUserMsg('msg1', 1000);
      createMessage({ id: 'msg-other', sessionId: otherSessionId, role: 'user', createdAt: 1000 });

      const db = getDatabase();
      const seq1 = (db.query('SELECT sequence FROM messages WHERE id = ?').get('msg1') as { sequence: number }).sequence;
      const seq2 = (db.query('SELECT sequence FROM messages WHERE id = ?').get('msg-other') as { sequence: number }).sequence;

      expect(seq1).toBe(1);
      expect(seq2).toBe(1); // Same sequence in different session is fine
    });
  });

  // ===========================================================================
  // Phase 2: Effective Context Loading
  // ===========================================================================

  describe('effective context loading (Phase 2)', () => {
    test('no compaction returns all messages', () => {
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);
      createUserMsg('msg3', 3000);

      const result = buildEffectiveContextHistory(sessionId);
      expect(result.messages).toHaveLength(3);
      expect(result.hasCompaction).toBe(false);
      expect(result.latestCompactionBoundary).toBeNull();
    });

    test('one compaction returns trigger, summary, and later messages', () => {
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);

      // Trigger
      createUserMsg('trigger', 3000);
      createPart({ id: 'cp1', messageId: 'trigger', createdAt: 3000, type: 'compaction', auto: true, overflow: false } as Part, sessionId);

      // Summary
      createAssistantMsg('summary', { summary: true, mode: 'compaction', parentId: 'trigger' } as Partial<AssistantMessage>, 4000);
      createPart({ id: 'sp1', messageId: 'summary', createdAt: 4000, type: 'text', text: 'Summary...' } as Part, sessionId);

      // Post-compaction
      createUserMsg('msg5', 5000);

      const result = buildEffectiveContextHistory(sessionId);
      expect(result.hasCompaction).toBe(true);
      expect(result.messages).toHaveLength(3); // trigger + summary + msg5
      expect(result.messages[0].message.id).toBe('trigger');
      expect(result.messages[1].message.id).toBe('summary');
      expect(result.messages[2].message.id).toBe('msg5');
      expect(result.latestCompactionBoundary).toBe('trigger');
    });

    test('multiple compactions use the latest valid boundary', () => {
      // First compaction
      createUserMsg('trigger1', 1000);
      createPart({ id: 'cp1', messageId: 'trigger1', createdAt: 1000, type: 'compaction', auto: true, overflow: false } as Part, sessionId);
      createAssistantMsg('summary1', { summary: true, mode: 'compaction', parentId: 'trigger1' } as Partial<AssistantMessage>, 2000);
      createPart({ id: 'sp1', messageId: 'summary1', createdAt: 2000, type: 'text', text: 'First summary' } as Part, sessionId);

      createUserMsg('msg3', 3000);

      // Second compaction
      createUserMsg('trigger2', 4000);
      createPart({ id: 'cp2', messageId: 'trigger2', createdAt: 4000, type: 'compaction', auto: true, overflow: false } as Part, sessionId);
      createAssistantMsg('summary2', { summary: true, mode: 'compaction', parentId: 'trigger2' } as Partial<AssistantMessage>, 5000);
      createPart({ id: 'sp2', messageId: 'summary2', createdAt: 5000, type: 'text', text: 'Second summary' } as Part, sessionId);

      createUserMsg('msg6', 6000);

      const result = buildEffectiveContextHistory(sessionId);
      expect(result.hasCompaction).toBe(true);
      expect(result.latestCompactionBoundary).toBe('trigger2');
      expect(result.messages).toHaveLength(3); // trigger2 + summary2 + msg6
    });

    test('orphaned trigger is ignored', () => {
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);

      // Orphaned trigger (no summary)
      createUserMsg('orphan-trigger', 3000);
      createPart({ id: 'cp1', messageId: 'orphan-trigger', createdAt: 3000, type: 'compaction', auto: true, overflow: false } as Part, sessionId);

      createUserMsg('msg4', 4000);

      const result = buildEffectiveContextHistory(sessionId);
      expect(result.hasCompaction).toBe(false);
      expect(result.messages).toHaveLength(4); // all messages
    });

    test('failed compaction outcome is ignored', () => {
      createUserMsg('msg1', 1000);

      // Trigger
      createUserMsg('trigger', 2000);
      createPart({ id: 'cp1', messageId: 'trigger', createdAt: 2000, type: 'compaction', auto: true, overflow: false } as Part, sessionId);

      // Failed compaction outcome (mode='compact_failed', not 'compaction')
      createAssistantMsg('failed-summary', {
        summary: true,
        mode: 'compact_failed',
        parentId: 'trigger',
      } as Partial<AssistantMessage>, 3000);
      createPart({ id: 'fsp', messageId: 'failed-summary', createdAt: 3000, type: 'text', text: 'Compaction failed' } as Part, sessionId);

      createUserMsg('msg4', 4000);

      const result = buildEffectiveContextHistory(sessionId);
      expect(result.hasCompaction).toBe(false);
    });

    test('summary with missing parent is ignored', () => {
      createUserMsg('msg1', 1000);

      // Summary that references a non-existent trigger
      createAssistantMsg('summary', {
        summary: true,
        mode: 'compaction',
        parentId: 'nonexistent-trigger',
      } as Partial<AssistantMessage>, 2000);
      createPart({ id: 'sp1', messageId: 'summary', createdAt: 2000, type: 'text', text: 'Summary' } as Part, sessionId);

      createUserMsg('msg3', 3000);

      const result = buildEffectiveContextHistory(sessionId);
      expect(result.hasCompaction).toBe(false);
    });

    test('summary with existing parent but no compaction part is ignored', () => {
      createUserMsg('msg1', 1000);

      // Trigger without a compaction part
      createUserMsg('trigger', 2000);
      // No compaction part on trigger

      createAssistantMsg('summary', {
        summary: true,
        mode: 'compaction',
        parentId: 'trigger',
      } as Partial<AssistantMessage>, 3000);
      createPart({ id: 'sp1', messageId: 'summary', createdAt: 3000, type: 'text', text: 'Summary' } as Part, sessionId);

      createUserMsg('msg4', 4000);

      const result = buildEffectiveContextHistory(sessionId);
      expect(result.hasCompaction).toBe(false);
    });

    test('pre-boundary message and part rows are absent from effective result', () => {
      // Pre-boundary messages
      createUserMsg('old1', 1000);
      createPart({ id: 'op1', messageId: 'old1', createdAt: 100, type: 'text', text: 'old content' } as Part, sessionId);
      createAssistantMsg('old2', {}, 2000);

      // Trigger
      createUserMsg('trigger', 3000);
      createPart({ id: 'cp1', messageId: 'trigger', createdAt: 3000, type: 'compaction', auto: true, overflow: false } as Part, sessionId);

      // Summary
      createAssistantMsg('summary', { summary: true, mode: 'compaction', parentId: 'trigger' } as Partial<AssistantMessage>, 4000);
      createPart({ id: 'sp1', messageId: 'summary', createdAt: 4000, type: 'text', text: 'Summary' } as Part, sessionId);

      // Post
      createUserMsg('new1', 5000);

      const result = buildEffectiveContextHistory(sessionId);
      expect(result.hasCompaction).toBe(true);
      const messageIds = result.messages.map((m) => m.message.id);
      expect(messageIds).not.toContain('old1');
      expect(messageIds).not.toContain('old2');
      expect(messageIds).toContain('trigger');
      expect(messageIds).toContain('summary');
      expect(messageIds).toContain('new1');
    });

    test('full-history API still returns pre-boundary rows', () => {
      createUserMsg('old1', 1000);
      createAssistantMsg('old2', {}, 2000);

      createUserMsg('trigger', 3000);
      createPart({ id: 'cp1', messageId: 'trigger', createdAt: 3000, type: 'compaction', auto: true, overflow: false } as Part, sessionId);
      createAssistantMsg('summary', { summary: true, mode: 'compaction', parentId: 'trigger' } as Partial<AssistantMessage>, 4000);

      createUserMsg('new1', 5000);

      const full = listMessagesWithParts(sessionId);
      expect(full).toHaveLength(5);
      expect(full.map((r) => r.message.id)).toContain('old1');
      expect(full.map((r) => r.message.id)).toContain('old2');
    });

    test('revert past the latest boundary selects the previous valid boundary', async () => {
      // First compaction
      createUserMsg('trigger1', 1000);
      createPart({ id: 'cp1', messageId: 'trigger1', createdAt: 1000, type: 'compaction', auto: true, overflow: false } as Part, sessionId);
      createAssistantMsg('summary1', { summary: true, mode: 'compaction', parentId: 'trigger1' } as Partial<AssistantMessage>, 2000);

      // Second compaction
      createUserMsg('trigger2', 3000);
      createPart({ id: 'cp2', messageId: 'trigger2', createdAt: 3000, type: 'compaction', auto: true, overflow: false } as Part, sessionId);
      createAssistantMsg('summary2', { summary: true, mode: 'compaction', parentId: 'trigger2' } as Partial<AssistantMessage>, 4000);

      createUserMsg('msg5', 5000);

      // Revert to summary1: deletes trigger2, summary2, msg5
      await revertToStep({ sessionId, targetMessageId: 'summary1', keepTarget: true });

      const result = buildEffectiveContextHistory(sessionId);
      expect(result.hasCompaction).toBe(true);
      expect(result.latestCompactionBoundary).toBe('trigger1');
    });

    test('revert past all boundaries returns full surviving history', async () => {
      createUserMsg('trigger', 1000);
      createPart({ id: 'cp1', messageId: 'trigger', createdAt: 1000, type: 'compaction', auto: true, overflow: false } as Part, sessionId);
      createAssistantMsg('summary', { summary: true, mode: 'compaction', parentId: 'trigger' } as Partial<AssistantMessage>, 2000);

      createUserMsg('msg3', 3000);

      // Revert to trigger: deletes summary, msg3
      await revertToStep({ sessionId, targetMessageId: 'trigger', keepTarget: true });

      const result = buildEffectiveContextHistory(sessionId);
      expect(result.hasCompaction).toBe(false);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].message.id).toBe('trigger');
    });

    test('forked compaction relationships are valid', async () => {
      createUserMsg('msg1', 1000);
      createAssistantMsg('msg2', {}, 2000);

      createUserMsg('trigger', 3000);
      createPart({ id: 'cp1', messageId: 'trigger', createdAt: 3000, type: 'compaction', auto: true, overflow: false } as Part, sessionId);
      createAssistantMsg('summary', { summary: true, mode: 'compaction', parentId: 'trigger' } as Partial<AssistantMessage>, 4000);

      const forkResult = await forkSession({ sessionId, targetMessageId: 'summary' });
      const forkedSessionId = forkResult.forkedSession.id;

      const result = buildEffectiveContextHistory(forkedSessionId);
      expect(result.hasCompaction).toBe(true);
      // Effective context starts at the trigger, not the first forked message
      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      expect(result.latestCompactionBoundary).not.toBeNull();
    });

    test('same-millisecond messages remain correct through sequence ordering', () => {
      const ts = Date.now();
      createUserMsg('msg1', ts);
      createAssistantMsg('msg2', {}, ts);

      const result = buildEffectiveContextHistory(sessionId);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].message.id).toBe('msg1');
      expect(result.messages[1].message.id).toBe('msg2');
    });

    test('returns empty for session with no messages', () => {
      const result = buildEffectiveContextHistory(sessionId);
      expect(result.messages).toHaveLength(0);
      expect(result.hasCompaction).toBe(false);
    });
  });

  // ===========================================================================
  // Phase 3: Streaming Snapshot Persistence
  // ===========================================================================

  describe('streaming snapshot persistence (Phase 3)', () => {
    test('persistStreamingPartSnapshot writes text without read-before-write', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      createPart({
        id: 'tp1',
        messageId: 'msg1',
        createdAt: 1000,
        type: 'text',
        text: 'initial',
      } as Part, sessionId);

      const ok = persistStreamingPartSnapshot({
        id: 'tp1',
        messageId: 'msg1',
        sessionId,
        type: 'text',
        createdAt: 1000,
        text: 'updated snapshot text',
      });

      expect(ok).toBe(true);
      const part = getPart('tp1');
      expect((part as unknown as Record<string, unknown>).text).toBe('updated snapshot text');
    });

    test('persistStreamingPartSnapshot returns false for identity mismatch', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      createPart({
        id: 'tp1',
        messageId: 'msg1',
        createdAt: 1000,
        type: 'text',
        text: 'initial',
      } as Part, sessionId);

      const ok = persistStreamingPartSnapshot({
        id: 'tp1',
        messageId: 'wrong-message',
        sessionId,
        type: 'text',
        createdAt: 1000,
        text: 'should not update',
      });

      expect(ok).toBe(false);
      const part = getPart('tp1');
      expect((part as unknown as Record<string, unknown>).text).toBe('initial');
    });

    test('persistStreamingPartSnapshots writes multiple in one transaction', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      createPart({ id: 'tp1', messageId: 'msg1', createdAt: 1000, type: 'text', text: 'a' } as Part, sessionId);
      createPart({ id: 'rp1', messageId: 'msg1', createdAt: 2000, type: 'reasoning', text: 'b' } as Part, sessionId);

      const count = persistStreamingPartSnapshots([
        { id: 'tp1', messageId: 'msg1', sessionId, type: 'text', createdAt: 1000, text: 'updated text' },
        { id: 'rp1', messageId: 'msg1', sessionId, type: 'reasoning', createdAt: 2000, text: 'updated reasoning' },
      ]);

      expect(count).toBe(2);
      expect((getPart('tp1') as unknown as Record<string, unknown>).text).toBe('updated text');
      expect((getPart('rp1') as unknown as Record<string, unknown>).text).toBe('updated reasoning');
    });

    test('persistStreamingPartSnapshots handles empty array', () => {
      expect(persistStreamingPartSnapshots([])).toBe(0);
    });

    test('createMessage does not create an empty FTS row', () => {
      createUserMsg('msg1');

      // Message was just created with no parts, should not be in FTS
      const db = getDatabase();
      const ftsRow = db.query('SELECT * FROM messages_fts WHERE message_id = ?').get('msg1');
      expect(ftsRow).toBeNull();
    });

    test('user text part creation syncs FTS immediately', () => {
      createUserMsg('msg1');
      createPart({ id: 'tp1', messageId: 'msg1', createdAt: 1000, type: 'text', text: 'hello world' } as Part, sessionId);

      syncMessageFts('msg1');

      const db = getDatabase();
      const ftsRow = db.query('SELECT * FROM messages_fts WHERE message_id = ?').get('msg1') as { content: string } | undefined;
      expect(ftsRow).toBeDefined();
      expect(ftsRow!.content).toContain('hello world');
    });

    test('syncMessageFts replaces FTS content atomically producing one row', () => {
      createUserMsg('msg1');
      createPart({ id: 'tp1', messageId: 'msg1', createdAt: 1000, type: 'text', text: 'first version' } as Part, sessionId);
      syncMessageFts('msg1');

      createPart({ id: 'tp2', messageId: 'msg1', createdAt: 2000, type: 'text', text: 'second version' } as Part, sessionId);
      syncMessageFts('msg1');

      const db = getDatabase();
      const ftsRows = db.query('SELECT * FROM messages_fts WHERE message_id = ?').all('msg1');
      expect(ftsRows).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Phase 4: Indexed Tool Call Lookup
  // ===========================================================================

  describe('indexed tool call lookup (Phase 4)', () => {
    test('tool creation writes matching JSON callId and call_id column', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      createToolPartPending('msg1', 'call-123', 'read-file', { path: '/test' }, sessionId);

      const db = getDatabase();
      const row = db.query('SELECT call_id, data FROM parts WHERE type = \'tool\'').get() as { call_id: string; data: string };
      expect(row.call_id).toBe('call-123');
      const parsed = JSON.parse(row.data);
      expect(parsed.callId).toBe('call-123');
    });

    test('non-tool parts write null call_id', () => {
      createUserMsg('msg1');
      createPart({ id: 'tp1', messageId: 'msg1', createdAt: 1000, type: 'text', text: 'hello' } as Part, sessionId);

      const db = getDatabase();
      const row = db.query('SELECT call_id FROM parts WHERE type = \'text\'').get() as { call_id: string | null };
      expect(row.call_id).toBeNull();
    });

    test('getToolPartByCallId returns the correct tool part via index', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      createToolPartPending('msg1', 'call-abc', 'shell', { command: 'ls' }, sessionId);

      const result = getToolPartByCallId(sessionId, 'call-abc');
      expect(result).not.toBeNull();
      expect(result!.callId).toBe('call-abc');
      expect(result!.name).toBe('shell');
    });

    test('getToolPartByCallId returns null for unknown call ID', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      createToolPartPending('msg1', 'call-1', 'shell', {}, sessionId);

      expect(getToolPartByCallId(sessionId, 'nonexistent')).toBeNull();
    });

    test('same call ID in two sessions does not collide', () => {
      const otherSessionId = 'other-session-callid';
      createSession(makeSession({ id: otherSessionId, workspaceId: 'ws1', title: 'Other', status: 'active' }));

      createAssistantMsg('msg1', { status: 'streaming' });
      createToolPartPending('msg1', 'shared-call', 'shell', {}, sessionId);

      createMessage({ id: 'msg2', sessionId: otherSessionId, role: 'assistant', createdAt: Date.now(), status: 'streaming', modelId: 'gpt-4o', providerId: 'openai', tokens: { prompt: 0, completion: 0 }, cost: 0 } as AssistantMessage);
      createToolPartPending('msg2', 'shared-call', 'read-file', {}, otherSessionId);

      const result1 = getToolPartByCallId(sessionId, 'shared-call');
      const result2 = getToolPartByCallId(otherSessionId, 'shared-call');

      expect(result1!.name).toBe('shell');
      expect(result2!.name).toBe('read-file');
    });

    test('state transitions preserve call_id', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const tool = createToolPartPending('msg1', 'call-preserve', 'shell', {}, sessionId);
      transitionToolToRunning(tool.id);
      transitionToolToCompleted(tool.id, 'done');

      const db = getDatabase();
      const row = db.query('SELECT call_id FROM parts WHERE id = ?').get(tool.id) as { call_id: string };
      expect(row.call_id).toBe('call-preserve');
    });

    test('transitionToolToRunningByCallId uses indexed lookup', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      createToolPartPending('msg1', 'call-idx', 'shell', {}, sessionId);

      const result = transitionToolToRunningByCallId(sessionId, 'call-idx', 'child-1');
      expect(result).not.toBeNull();
      expect(result!.state.status).toBe('running');
      if (result!.state.status === 'running') {
        expect(result!.state.childSessionId).toBe('child-1');
      }
    });

    test('transitionToolToRunningByCallId prefers latest inserted equal-time pending part', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const first = createToolPartPending('msg1', 'duplicate-call', 'shell', {}, sessionId);
      const second = createToolPartPending('msg1', 'duplicate-call', 'shell', {}, sessionId);
      const db = getDatabase();
      db.run('UPDATE parts SET created_at = ? WHERE id IN (?, ?)', [1000, first.id, second.id]);

      const result = transitionToolToRunningByCallId(sessionId, 'duplicate-call');

      expect(result?.id).toBe(second.id);
      expect((getPart(first.id) as ToolPart).state.status).toBe('pending');
    });

    test('getToolPartByCallId with legacy JSON fallback', () => {
      createAssistantMsg('msg1', { status: 'streaming' });

      // Manually insert a tool part with NULL call_id (simulating unmigrated row)
      const db = getDatabase();
      db.run(
        `INSERT INTO parts (id, message_id, session_id, type, call_id, data, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        ['legacy-part', 'msg1', sessionId, 'tool', JSON.stringify({ callId: 'legacy-call', name: 'old-tool', state: { status: 'pending', input: {} } }), Date.now()],
      );

      const result = getToolPartByCallId(sessionId, 'legacy-call');
      expect(result).not.toBeNull();
      expect(result!.callId).toBe('legacy-call');
      expect(result!.name).toBe('old-tool');
    });

    test('legacy JSON fallback prefers a pending part over a newer completed part', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      const db = getDatabase();
      const pending = {
        callId: 'legacy-duplicate',
        name: 'old-tool',
        state: { status: 'pending', input: {} },
      };
      const completed = {
        callId: 'legacy-duplicate',
        name: 'old-tool',
        state: {
          status: 'completed',
          input: {},
          output: 'done',
          startedAt: 1000,
          completedAt: 1001,
        },
      };
      const insert = db.prepare(
        `INSERT INTO parts (id, message_id, session_id, type, call_id, data, created_at)
         VALUES (?, ?, ?, 'tool', NULL, ?, ?)`,
      );
      insert.run('legacy-pending', 'msg1', sessionId, JSON.stringify(pending), 1000);
      insert.run('legacy-completed', 'msg1', sessionId, JSON.stringify(completed), 2000);

      const result = transitionToolToRunningByCallId(sessionId, 'legacy-duplicate');

      expect(result?.id).toBe('legacy-pending');
      expect(result?.state.status).toBe('running');
    });

    test('query plan uses idx_parts_session_call_id', () => {
      createAssistantMsg('msg1', { status: 'streaming' });
      createToolPartPending('msg1', 'call-plan', 'shell', {}, sessionId);

      const db = getDatabase();
      const plan = db.query(
        `EXPLAIN QUERY PLAN
         SELECT * FROM parts
         WHERE session_id = ? AND call_id = ? AND type = 'tool'`,
      ).all(sessionId, 'call-plan') as { detail: string }[];

      const planText = plan.map((p) => p.detail).join(' ');
      expect(planText).toContain('idx_parts_session_call_id');
    });
  });
});
