import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { forkSession } from '@capekai/core/internal/execution';
import { createMessage, createPart, listMessagesWithParts } from '@/store';
import { getSession } from '@/store/sessions';
import type { AssistantMessage, ToolPart } from '@jean2/sdk';

describe('forkSession', () => {
  let sessionId: string;
  let workspaceId: string;

  beforeEach(() => {
    setupTestDatabase();
    const ctx = seedWorkspaceWithSession();
    sessionId = ctx.sessionId;
    workspaceId = ctx.workspaceId;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function createUserMsg(id: string, ts: number = Date.now()) {
    return createMessage({ id, sessionId, role: 'user', createdAt: ts });
  }

  function createAssistantMsg(id: string, ts: number = Date.now()) {
    return createMessage({
      id,
      sessionId,
      role: 'assistant',
      createdAt: ts,
      status: 'completed',
      modelId: 'gpt-4o',
      providerId: 'openai',
      tokens: { prompt: 100, completion: 50 },
      cost: 0,
      completedAt: ts,
    } as AssistantMessage);
  }

  function addTextPart(messageId: string, text: string) {
    createPart({
      id: crypto.randomUUID(),
      messageId,
      createdAt: Date.now(),
      type: 'text',
      text,
    }, sessionId);
  }

  function addToolPart(messageId: string, callId: string, name: string = 'read-file') {
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
    } as ToolPart, sessionId);
  }

  test('copies messages up to and including target message', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Hello');
    createAssistantMsg('msg2', 2000);
    addTextPart('msg2', 'Hi');
    createUserMsg('msg3', 3000);
    addTextPart('msg3', 'How are you?');
    createAssistantMsg('msg4', 4000);
    addTextPart('msg4', 'I am fine');

    // Fork at msg2 (should include msg1 and msg2)
    const result = await forkSession({ sessionId, targetMessageId: 'msg2' });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].message.role).toBe('user');
    expect(result.messages[1].message.role).toBe('assistant');

    // Forked session should exist
    const forkedSession = getSession(result.forkedSession.id);
    expect(forkedSession).toBeDefined();
    expect(forkedSession!.title).toContain('fork');
    expect(forkedSession!.workspaceId).toBe(workspaceId);
  });

  test('forked session has metadata pointing to source', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Hello');
    createAssistantMsg('msg2', 2000);
    addTextPart('msg2', 'Hi');

    const result = await forkSession({ sessionId, targetMessageId: 'msg2' });

    const forkedSession = getSession(result.forkedSession.id);
    expect(forkedSession!.metadata).toBeDefined();
    expect((forkedSession!.metadata as Record<string, unknown>).forkedFrom).toBe(sessionId);
  });

  test('uses custom title when provided', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Hello');
    createAssistantMsg('msg2', 2000);
    addTextPart('msg2', 'Hi');

    const result = await forkSession({
      sessionId,
      targetMessageId: 'msg2',
      title: 'My custom fork',
    });

    expect(result.forkedSession.title).toBe('My custom fork');
  });

  test('copies tool parts along with messages', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Read the file');
    createAssistantMsg('msg2', 2000);
    addToolPart('msg2', 'call-1');
    addTextPart('msg2', 'Here is the result');

    const result = await forkSession({ sessionId, targetMessageId: 'msg2' });

    expect(result.messages).toHaveLength(2);
    const assistantParts = result.messages[1].parts;
    // Should have tool part + text part
    expect(assistantParts.length).toBeGreaterThanOrEqual(2);
    const toolPart = assistantParts.find(p => p.type === 'tool');
    expect(toolPart).toBeDefined();
    expect((toolPart as ToolPart).name).toBe('read-file');
  });

  test('throws if source session not found', async () => {
    await expect(
      forkSession({ sessionId: 'nonexistent', targetMessageId: 'x' }),
    ).rejects.toThrow('Source session not found');
  });

  test('throws if target message not found', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Hello');
    createAssistantMsg('msg2', 2000);
    addTextPart('msg2', 'Hi');

    await expect(
      forkSession({ sessionId, targetMessageId: 'nonexistent' }),
    ).rejects.toThrow('Target message not found');
  });

  test('forked messages have new IDs', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Hello');
    createAssistantMsg('msg2', 2000);
    addTextPart('msg2', 'Hi');

    const result = await forkSession({ sessionId, targetMessageId: 'msg2' });

    // Forked message IDs should differ from originals
    const forkedMsgIds = result.messages.map(m => m.message.id);
    expect(forkedMsgIds).not.toContain('msg1');
    expect(forkedMsgIds).not.toContain('msg2');
  });

  test('forked messages are independent from source', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Hello');
    createAssistantMsg('msg2', 2000);
    addTextPart('msg2', 'Hi');

    const result = await forkSession({ sessionId, targetMessageId: 'msg2' });

    // Verify forked messages exist in the new session
    const forkedMessages = listMessagesWithParts(result.forkedSession.id);
    expect(forkedMessages).toHaveLength(2);

    // Source session should still have all messages
    const sourceMessages = listMessagesWithParts(sessionId);
    expect(sourceMessages).toHaveLength(2);
  });
});
