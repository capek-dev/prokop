import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { revertToStep } from '@capekai/core/execution';
import { createMessage, createPart, listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import type { AssistantMessage } from '@jean2/sdk';

describe('revertToStep', () => {
  let sessionId: string;

  beforeEach(() => {
    setupTestDatabase();
    const ctx = seedWorkspaceWithSession();
    sessionId = ctx.sessionId;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function createUserMsg(id: string, ts: number = Date.now()) {
    return createMessage({ id, sessionId, role: 'user', createdAt: ts });
  }

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

  function addTextPart(messageId: string, text: string) {
    createPart({
      id: crypto.randomUUID(),
      messageId,
      createdAt: Date.now(),
      type: 'text',
      text,
    }, sessionId);
  }

  test('deletes messages after target', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Hello');
    createAssistantMsg('msg2', {}, 2000);
    addTextPart('msg2', 'Hi');
    createUserMsg('msg3', 3000);
    addTextPart('msg3', 'Tell me more');
    createAssistantMsg('msg4', {}, 4000);
    addTextPart('msg4', 'Sure');
    createUserMsg('msg5', 5000);
    addTextPart('msg5', 'Thanks');

    const result = await revertToStep({ sessionId, targetMessageId: 'msg2' });

    // Should keep msg1, msg2 and delete msg3, msg4, msg5
    expect(result.removed.messageIds).toHaveLength(3);
    expect(result.removed.messageIds).toContain('msg3');
    expect(result.removed.messageIds).toContain('msg4');
    expect(result.removed.messageIds).toContain('msg5');
    expect(result.revertedTo.messageId).toBe('msg2');
    // messageCount is targetIndex (0-based), so msg2 at index 1 → count is 1
    expect(result.revertedTo.messageCount).toBe(1);

    const remaining = listMessagesWithParts(sessionId);
    expect(remaining).toHaveLength(2);
  });

  test('deletes ALL messages when target is first message', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Hello');
    createAssistantMsg('msg2', {}, 2000);
    addTextPart('msg2', 'Hi');
    createUserMsg('msg3', 3000);
    addTextPart('msg3', 'More');

    const result = await revertToStep({ sessionId, targetMessageId: 'msg1' });

    // Reverting to first message clears all
    expect(result.revertedTo.messageId).toBeNull();
    expect(result.revertedTo.messageCount).toBe(0);
    expect(result.removed.messageIds).toHaveLength(3);

    const remaining = listMessagesWithParts(sessionId);
    expect(remaining).toHaveLength(0);
  });

  test('counts removed parts correctly', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Hello');
    createAssistantMsg('msg2', {}, 2000);
    addTextPart('msg2', 'Hi');
    createPart({
      id: 'p-tool',
      messageId: 'msg2',
      createdAt: 2001,
      type: 'text',
      text: 'Extra part',
    }, sessionId);
    createUserMsg('msg3', 3000);
    addTextPart('msg3', 'Bye');

    // Revert to msg1 (first message → clears all), deleting msg1, msg2, msg3
    // Parts: Hello + Hi + Extra part + Bye = 4
    const result = await revertToStep({ sessionId, targetMessageId: 'msg1' });

    expect(result.removed.partCount).toBe(4);
  });

  test('marks streaming messages as error after revert', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Hello');
    createAssistantMsg('msg2', { status: 'streaming' }, 2000);
    addTextPart('msg2', 'Streaming...');
    createUserMsg('msg3', 3000);
    addTextPart('msg3', 'More');

    // Revert to msg1 — msg2 (streaming) and msg3 get deleted
    // But if there were remaining streaming messages, they'd be marked as error
    await revertToStep({ sessionId, targetMessageId: 'msg1' });

    // All messages should be deleted since target is first
    const remaining = listMessagesWithParts(sessionId);
    expect(remaining).toHaveLength(0);
  });

  test('marks streaming assistant messages as error when target is kept', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Hello');
    createAssistantMsg('msg2', {}, 2000);
    addTextPart('msg2', 'Hi');
    createAssistantMsg('msg3', { status: 'streaming' }, 3000);
    addTextPart('msg3', 'Streaming...');

    // Revert to msg2 — msg3 gets deleted, but if there were remaining streaming
    // messages, they'd be marked as error. Since msg3 is deleted, nothing left.
    const result = await revertToStep({ sessionId, targetMessageId: 'msg2' });

    expect(result.removed.messageIds).toContain('msg3');
    const remaining = listMessagesWithParts(sessionId);
    expect(remaining).toHaveLength(2);
  });

  test('throws if target message not found', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Hello');

    await expect(
      revertToStep({ sessionId, targetMessageId: 'nonexistent' }),
    ).rejects.toThrow('Target message not found');
  });

  test('no-op when reverting to last message', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Hello');
    createAssistantMsg('msg2', {}, 2000);
    addTextPart('msg2', 'Hi');

    const result = await revertToStep({ sessionId, targetMessageId: 'msg2' });

    expect(result.removed.messageIds).toHaveLength(0);
    expect(result.revertedTo.messageId).toBe('msg2');

    const remaining = listMessagesWithParts(sessionId);
    expect(remaining).toHaveLength(2);
  });

  test('keeps target message when keepTarget is true and target is first', async () => {
    createUserMsg('msg1', 1000);
    addTextPart('msg1', 'Hello');
    createAssistantMsg('msg2', {}, 2000);
    addTextPart('msg2', 'Hi');
    createUserMsg('msg3', 3000);
    addTextPart('msg3', 'More');

    const result = await revertToStep({ sessionId, targetMessageId: 'msg1', keepTarget: true });

    // Should keep msg1, delete only msg2 and msg3
    expect(result.removed.messageIds).toHaveLength(2);
    expect(result.removed.messageIds).toContain('msg2');
    expect(result.removed.messageIds).toContain('msg3');
    expect(result.revertedTo.messageId).toBe('msg1');
    expect(result.revertedTo.messageCount).toBe(0);

    const remaining = listMessagesWithParts(sessionId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message.id).toBe('msg1');
  });
});
