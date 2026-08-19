import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { getDefaultCompactionPolicy, resolveCompactionPolicy, createCompactionTrigger, processCompactionTask, persistCompactionFailure } from '@capekai/core/execution';
import { type GenerateSummaryFn } from '@capekai/core/execution';
import { createMessage, createPart, getPartsBySession, listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import type { AssistantMessage, CompactionPart, ToolPart } from '@jean2/sdk';
import { type RuntimeEvent } from '@capekai/core';

function createFakeGenerateSummary(overrides: {
  text?: string;
  usage?: { prompt: number; completion: number };
  effectiveModelId?: string;
  effectiveProviderId?: string;
  shouldThrow?: Error;
}): GenerateSummaryFn {
  return async (_prompt: string, _policy) => {
    if (overrides.shouldThrow) throw overrides.shouldThrow;
    return {
      text: overrides.text ?? '## Summary\n\nCompacted conversation summary.',
      usage: overrides.usage ?? { prompt: 10, completion: 20 },
      effectiveModelId: overrides.effectiveModelId ?? 'gpt-4o',
      effectiveProviderId: overrides.effectiveProviderId ?? 'openai',
    };
  };
}

describe('compaction', () => {
  let sessionId: string;
  const broadcastMessages: RuntimeEvent[] = [];
  const broadcastFn = (event: RuntimeEvent) => broadcastMessages.push(event);

  beforeEach(() => {
    setupTestDatabase();
    const ctx = seedWorkspaceWithSession();
    sessionId = ctx.sessionId;
    broadcastMessages.length = 0;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  // Helpers to create conversation
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

  // ===========================================================================
  // getDefaultCompactionPolicy
  // ===========================================================================
  describe('getDefaultCompactionPolicy', () => {
    test('returns a policy with all required fields', () => {
      const policy = getDefaultCompactionPolicy();
      expect(policy.modelId).toBeNull();
      expect(policy.providerId).toBeNull();
      expect(typeof policy.maxOutputTokens).toBe('number');
      expect(policy.maxOutputTokens).toBeGreaterThan(0);
      expect(typeof policy.preserveRecentToolCount).toBe('number');
      expect(typeof policy.preserveSmallToolChars).toBe('number');
      expect(typeof policy.toolClearCharsThreshold).toBe('number');
      expect(typeof policy.maxPrunedToolCount).toBe('number');
      expect(typeof policy.autoThresholdRatio).toBe('number');
      expect(typeof policy.autoReserveCapTokens).toBe('number');
      expect(typeof policy.autoSafetyMarginTokens).toBe('number');
    });
  });

  // ===========================================================================
  // resolveCompactionPolicy
  // ===========================================================================
  describe('resolveCompactionPolicy', () => {
    test('returns defaults when no session or overrides', () => {
      const policy = resolveCompactionPolicy(undefined, undefined);
      const defaults = getDefaultCompactionPolicy();
      expect(policy.maxOutputTokens).toBe(defaults.maxOutputTokens);
      expect(policy.preserveRecentToolCount).toBe(defaults.preserveRecentToolCount);
    });

    test('uses session model/provider as fallback', () => {
      const policy = resolveCompactionPolicy('gpt-4o', 'openai');
      expect(policy.modelId).toBe('gpt-4o');
      expect(policy.providerId).toBe('openai');
    });

    test('overrides take precedence over session and defaults', () => {
      const policy = resolveCompactionPolicy('gpt-4o', 'openai', {
        maxOutputTokens: 9999,
        preserveRecentToolCount: 10,
        modelId: 'claude-3-opus',
        providerId: 'anthropic',
      });
      expect(policy.maxOutputTokens).toBe(9999);
      expect(policy.preserveRecentToolCount).toBe(10);
      expect(policy.modelId).toBe('claude-3-opus');
      expect(policy.providerId).toBe('anthropic');
    });

    test('partial overrides only affect specified fields', () => {
      const defaults = getDefaultCompactionPolicy();
      const policy = resolveCompactionPolicy('gpt-4o', 'openai', {
        maxOutputTokens: 5000,
      });
      expect(policy.maxOutputTokens).toBe(5000);
      expect(policy.preserveRecentToolCount).toBe(defaults.preserveRecentToolCount);
      expect(policy.modelId).toBe('gpt-4o');
    });

    test('all pruning fields can be overridden', () => {
      const policy = resolveCompactionPolicy('gpt-4o', 'openai', {
        preserveRecentToolCount: 5,
        preserveSmallToolChars: 500,
        toolClearCharsThreshold: 2000,
        maxPrunedToolCount: 20,
        autoThresholdRatio: 0.8,
        autoReserveCapTokens: 50000,
        autoSafetyMarginTokens: 10000,
      });
      expect(policy.preserveRecentToolCount).toBe(5);
      expect(policy.preserveSmallToolChars).toBe(500);
      expect(policy.toolClearCharsThreshold).toBe(2000);
      expect(policy.maxPrunedToolCount).toBe(20);
      expect(policy.autoThresholdRatio).toBe(0.8);
      expect(policy.autoReserveCapTokens).toBe(50000);
      expect(policy.autoSafetyMarginTokens).toBe(10000);
    });
  });

  // ===========================================================================
  // createCompactionTrigger
  // ===========================================================================
  describe('createCompactionTrigger', () => {
    test('creates trigger with manual reason', () => {
      createUserMsg('msg1', 1000);
      addTextPart('msg1', 'Hello');
      createAssistantMsg('msg2', {}, 2000);
      addTextPart('msg2', 'Hi there');

      const trigger = createCompactionTrigger(sessionId, 'manual');
      expect(trigger.messageId).toBeDefined();
      expect(trigger.reason).toBe('manual');

      const allMsgs = listMessagesWithParts(sessionId);
      const triggerMsg = allMsgs.find(m => m.message.id === trigger.messageId);
      expect(triggerMsg).toBeDefined();
      expect(triggerMsg!.message.role).toBe('user');

      const compactionPart = triggerMsg!.parts.find(p => p.type === 'compaction') as CompactionPart;
      expect(compactionPart).toBeDefined();
      expect(compactionPart.auto).toBe(false);
      expect(compactionPart.overflow).toBeFalsy();
    });

    test('creates trigger with auto reason', () => {
      createUserMsg('msg1', 1000);
      addTextPart('msg1', 'Hello');
      createAssistantMsg('msg2', {}, 2000);
      addTextPart('msg2', 'Hi there');

      const trigger = createCompactionTrigger(sessionId, 'auto');
      expect(trigger.reason).toBe('auto');

      const allMsgs = listMessagesWithParts(sessionId);
      const compactionPart = allMsgs
        .find(m => m.message.id === trigger.messageId)!
        .parts.find(p => p.type === 'compaction') as CompactionPart;
      expect(compactionPart.auto).toBe(true);
    });

    test('creates trigger with overflow reason', () => {
      createUserMsg('msg1', 1000);
      addTextPart('msg1', 'Hello');
      createAssistantMsg('msg2', {}, 2000);
      addTextPart('msg2', 'Hi there');

      const trigger = createCompactionTrigger(sessionId, 'overflow');
      expect(trigger.reason).toBe('overflow');

      const allMsgs = listMessagesWithParts(sessionId);
      const compactionPart = allMsgs
        .find(m => m.message.id === trigger.messageId)!
        .parts.find(p => p.type === 'compaction') as CompactionPart;
      expect(compactionPart.auto).toBe(true);
      expect(compactionPart.overflow).toBe(true);
    });

    test('throws when fewer than 2 non-system messages', () => {
      createUserMsg('msg1', 1000);
      addTextPart('msg1', 'Hello');

      expect(() => createCompactionTrigger(sessionId, 'manual')).toThrow(
        'Not enough messages for compaction',
      );
    });

    test('throws when no messages exist', () => {
      expect(() => createCompactionTrigger(sessionId, 'manual')).toThrow(
        'Not enough messages for compaction',
      );
    });
  });

  // ===========================================================================
  // processCompactionTask
  // ===========================================================================
  describe('processCompactionTask', () => {
    test('generates summary from conversation', async () => {
      createUserMsg('msg1', 1000);
      addTextPart('msg1', 'What is TypeScript?');
      createAssistantMsg('msg2', {}, 2000);
      addTextPart('msg2', 'TypeScript is a typed superset of JavaScript.');
      createUserMsg('msg3', 3000);
      addTextPart('msg3', 'Tell me more.');
      createAssistantMsg('msg4', {}, 4000);
      addTextPart('msg4', 'TypeScript adds static types and more.');

      const trigger = createCompactionTrigger(sessionId, 'manual');
      const policy = resolveCompactionPolicy('gpt-4o', 'openai');

      const result = await processCompactionTask(
        sessionId,
        trigger.messageId,
        policy,
        createFakeGenerateSummary({ text: '## Summary\n\nCompacted conversation summary.' }),
      );

      expect(result.trigger.messageId).toBe(trigger.messageId);
      expect(result.trigger.reason).toBe('manual');
      expect(result.summaryMessage.role).toBe('assistant');
      expect(result.summaryMessage.summary).toBe(true);
      expect(result.summaryMessage.mode).toBe('compaction');
      expect(result.summaryMessage.parentId).toBe(trigger.messageId);
      expect(result.textParts).toHaveLength(1);
      expect(result.textParts[0].text).toBe('## Summary\n\nCompacted conversation summary.');
      expect(result.tokensUsed.prompt).toBe(10);
      expect(result.tokensUsed.completion).toBe(20);
    });

    test('records effective model/provider from generateSummary', async () => {
      createUserMsg('msg1', 1000);
      addTextPart('msg1', 'Hello');
      createAssistantMsg('msg2', {}, 2000);
      addTextPart('msg2', 'Hi');

      const trigger = createCompactionTrigger(sessionId, 'manual');
      const policy = resolveCompactionPolicy('gpt-4o', 'openai');

      const result = await processCompactionTask(
        sessionId,
        trigger.messageId,
        policy,
        createFakeGenerateSummary({
          text: 'Summary text',
          effectiveModelId: 'claude-3-opus',
          effectiveProviderId: 'anthropic',
          usage: { prompt: 50, completion: 30 },
        }),
      );

      expect(result.summaryMessage.modelId).toBe('claude-3-opus');
      expect(result.summaryMessage.providerId).toBe('anthropic');
      expect(result.tokensUsed).toEqual({ prompt: 50, completion: 30 });
    });

    test('marks large tool outputs as compacted', async () => {
      createUserMsg('msg1', 1000);
      addTextPart('msg1', 'Read the file');

      createAssistantMsg('msg2', {}, 2000);
      const toolPart: ToolPart = {
        id: 'tp1',
        messageId: 'msg2',
        createdAt: 2000,
        type: 'tool',
        callId: 'call-1',
        name: 'read-file',
        state: {
          status: 'completed',
          input: { path: '/test.txt' },
          output: 'A'.repeat(5000),
          startedAt: 2000,
          completedAt: 2100,
        },
      };
      createPart(toolPart, sessionId);

      createUserMsg('msg3', 3000);
      addTextPart('msg3', 'Thanks');

      createAssistantMsg('msg4', {}, 4000);
      addTextPart('msg4', 'You are welcome');

      const trigger = createCompactionTrigger(sessionId, 'manual');
      const policy = resolveCompactionPolicy('gpt-4o', 'openai', {
        preserveRecentToolCount: 0,
        preserveSmallToolChars: 0,
        toolClearCharsThreshold: 100,
        maxPrunedToolCount: 50,
      });

      await processCompactionTask(
        sessionId, trigger.messageId, policy,
        createFakeGenerateSummary({}),
      );

      const parts = getPartsBySession(sessionId);
      const updatedToolPart = parts.find(p => p.id === 'tp1') as ToolPart;
      expect(updatedToolPart).toBeDefined();
      expect((updatedToolPart.state as { compactedAt?: number }).compactedAt).toBeDefined();
    });

    test('preserves skill tool outputs from compaction', async () => {
      createUserMsg('msg1', 1000);
      addTextPart('msg1', 'Use the skill');

      createAssistantMsg('msg2', {}, 2000);
      const toolPart: ToolPart = {
        id: 'tp-skill',
        messageId: 'msg2',
        createdAt: 2000,
        type: 'tool',
        callId: 'call-skill',
        name: 'skill',
        state: {
          status: 'completed',
          input: { name: 'test-skill' },
          output: 'A'.repeat(5000),
          startedAt: 2000,
          completedAt: 2100,
        },
      };
      createPart(toolPart, sessionId);

      createUserMsg('msg3', 3000);
      addTextPart('msg3', 'Thanks');

      createAssistantMsg('msg4', {}, 4000);
      addTextPart('msg4', 'Done');

      const trigger = createCompactionTrigger(sessionId, 'manual');
      const policy = resolveCompactionPolicy('gpt-4o', 'openai', {
        preserveRecentToolCount: 0,
        preserveSmallToolChars: 0,
        toolClearCharsThreshold: 100,
        maxPrunedToolCount: 50,
      });

      await processCompactionTask(
        sessionId, trigger.messageId, policy,
        createFakeGenerateSummary({}),
      );

      const parts = getPartsBySession(sessionId);
      const skillPart = parts.find(p => p.id === 'tp-skill') as ToolPart;
      expect(skillPart).toBeDefined();
      expect((skillPart.state as { compactedAt?: number }).compactedAt).toBeUndefined();
    });

    test('preserves small tool outputs from compaction', async () => {
      createUserMsg('msg1', 1000);
      addTextPart('msg1', 'Read the file');

      createAssistantMsg('msg2', {}, 2000);
      const toolPart: ToolPart = {
        id: 'tp-small',
        messageId: 'msg2',
        createdAt: 2000,
        type: 'tool',
        callId: 'call-small',
        name: 'read-file',
        state: {
          status: 'completed',
          input: { path: '/test.txt' },
          output: 'Small output',
          startedAt: 2000,
          completedAt: 2100,
        },
      };
      createPart(toolPart, sessionId);

      createUserMsg('msg3', 3000);
      addTextPart('msg3', 'Thanks');

      createAssistantMsg('msg4', {}, 4000);
      addTextPart('msg4', 'Done');

      const trigger = createCompactionTrigger(sessionId, 'manual');
      const policy = resolveCompactionPolicy('gpt-4o', 'openai', {
        preserveRecentToolCount: 0,
        preserveSmallToolChars: 200,
        toolClearCharsThreshold: 100,
        maxPrunedToolCount: 50,
      });

      await processCompactionTask(
        sessionId, trigger.messageId, policy,
        createFakeGenerateSummary({}),
      );

      const parts = getPartsBySession(sessionId);
      const smallPart = parts.find(p => p.id === 'tp-small') as ToolPart;
      expect(smallPart).toBeDefined();
      expect((smallPart.state as { compactedAt?: number }).compactedAt).toBeUndefined();
    });

    test('throws when trigger message not found', async () => {
      const policy = resolveCompactionPolicy('gpt-4o', 'openai');
      await expect(
        processCompactionTask(sessionId, 'nonexistent-msg', policy),
      ).rejects.toThrow('Trigger message not found');
    });

    test('throws when trigger has no compaction part', async () => {
      createUserMsg('msg-no-compaction', 1000);
      addTextPart('msg-no-compaction', 'Plain message');

      const policy = resolveCompactionPolicy('gpt-4o', 'openai');
      await expect(
        processCompactionTask(sessionId, 'msg-no-compaction', policy),
      ).rejects.toThrow('Trigger message does not have a compaction part');
    });

    test('propagates errors from generateSummary', async () => {
      createUserMsg('msg1', 1000);
      addTextPart('msg1', 'Hello');
      createAssistantMsg('msg2', {}, 2000);
      addTextPart('msg2', 'Hi');

      const trigger = createCompactionTrigger(sessionId, 'manual');
      const policy = resolveCompactionPolicy('gpt-4o', 'openai');

      await expect(
        processCompactionTask(
          sessionId, trigger.messageId, policy,
          createFakeGenerateSummary({ shouldThrow: new Error('LLM unavailable') }),
        ),
      ).rejects.toThrow('LLM unavailable');
    });
  });

  // ===========================================================================
  // persistCompactionFailure
  // ===========================================================================
  describe('persistCompactionFailure', () => {
    test('creates error message with compact_failed mode', () => {
      persistCompactionFailure(sessionId, 'trigger-1', 'Model API error', broadcastFn);

      const allMsgs = listMessagesWithParts(sessionId);
      const failedMsg = allMsgs.find(m => {
        const msg = m.message as AssistantMessage;
        return msg.role === 'assistant' && msg.mode === 'compact_failed';
      });

      expect(failedMsg).toBeDefined();
      const msg = failedMsg!.message as AssistantMessage;
      expect(msg.status).toBe('error');
      expect(msg.mode).toBe('compact_failed');
      expect(msg.parentId).toBe('trigger-1');
      expect(msg.error).toBe('Model API error');

      const textPart = failedMsg!.parts.find(p => p.type === 'text');
      expect(textPart).toBeDefined();
    });

    test('broadcasts failure events', () => {
      persistCompactionFailure(sessionId, 'trigger-1', 'Timeout', broadcastFn);

      expect(broadcastMessages.length).toBeGreaterThanOrEqual(2);
      expect(broadcastMessages).toContainEqual(expect.objectContaining({ kind: 'message', action: 'created' }));
      expect(broadcastMessages).toContainEqual(expect.objectContaining({ kind: 'part', action: 'created' }));
    });
  });
});
