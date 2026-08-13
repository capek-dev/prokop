import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import type { AssistantMessage, ServerMessage } from '@jean2/sdk';
import {
  getJean2CompatibilityBindings,
  setJean2CompatibilityBindings,
} from '@capekai/core/compat/jean2';
import type { ModelFactoryOptions } from '@capekai/core/compat/jean2';
import { configureCapekJean2Compatibility } from '@/capek-adapter';
import { executeCompaction, isCompactionActive } from '@/core/compaction-executor';
import {
  createMessage,
  createPart,
  createSession,
  getSession,
  listMessagesWithParts,
} from '@/store';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';

interface ModelControl {
  modelFactoryError?: unknown;
  wait?: Promise<void>;
  requestedModels: ModelFactoryOptions[];
}

function createCompactionModel(control: ModelControl): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => {
      if (control.wait) await control.wait;
      return {
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
      };
    },
  });
}

function installBindings(control: ModelControl): void {
  configureCapekJean2Compatibility();
  const bindings = getJean2CompatibilityBindings();
  const model = createCompactionModel(control);
  setJean2CompatibilityBindings({
    ...bindings,
    providers: {
      getProvider: () => ({}) as ReturnType<typeof bindings.providers.getProvider>,
      createModelForProvider: async (options) => {
        control.requestedModels.push(options);
        if (control.modelFactoryError !== undefined) throw control.modelFactoryError;
        return { model };
      },
    },
  });
}

function createConversation(sessionId: string): void {
  const userMessage = createMessage({
    id: 'user-1',
    sessionId,
    role: 'user',
    createdAt: 1,
  });
  createPart({
    id: 'user-text-1',
    messageId: userMessage.id,
    createdAt: 1,
    type: 'text',
    text: 'Explain TypeScript.',
  }, sessionId);
  const assistantMessage = createMessage({
    id: 'assistant-1',
    sessionId,
    role: 'assistant',
    status: 'completed',
    modelId: 'gpt-4o',
    providerId: 'openai',
    tokens: { prompt: 5, completion: 5 },
    cost: 0,
    createdAt: 2,
    completedAt: 2,
  } as AssistantMessage);
  createPart({
    id: 'assistant-text-1',
    messageId: assistantMessage.id,
    createdAt: 2,
    type: 'text',
    text: 'TypeScript adds static types.',
  }, sessionId);
}

function noBroadcast(_message: ServerMessage): void {}

describe('package-owned compaction executor', () => {
  let sessionId: string;
  let workspaceId: string;
  let control: ModelControl;

  beforeEach(() => {
    setupTestDatabase();
    ({ sessionId, workspaceId } = seedWorkspaceWithSession());
    control = { requestedModels: [] };
    installBindings(control);
  });

  afterEach(() => {
    resetTestDatabase();
    configureCapekJean2Compatibility();
  });

  test('rejects missing and child sessions without starting compaction', async () => {
    const missing = await executeCompaction('missing', 'manual', noBroadcast, () => {});
    expect(missing).toEqual({
      ok: false,
      error: 'Compaction is only available for main sessions',
      triggerMessageId: null,
      reason: 'manual',
      skipped: true,
    });

    const child = createSession({
      id: 'child-1',
      workspaceId,
      preconfigId: null,
      title: 'Child',
      status: 'active',
      metadata: null,
      parentId: sessionId,
      agentName: 'child',
    });
    const childResult = await executeCompaction(child.id, 'manual', noBroadcast, () => {});
    expect(childResult.ok).toBe(false);
    expect(isCompactionActive(child.id)).toBe(false);
  });

  test('persists summary, usage, state transitions, and reason on success', async () => {
    createConversation(sessionId);
    const sessionUpdates: boolean[] = [];

    const result = await executeCompaction(
      sessionId,
      'auto',
      noBroadcast,
      (session) => sessionUpdates.push(session.compacting === true),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reason).toBe('auto');
    expect(result.result.tokensUsed).toMatchObject({ prompt: 10, completion: 20 });
    expect(sessionUpdates).toEqual([true, false]);
    expect(getSession(sessionId)).toMatchObject({
      compacting: false,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
    const summary = listMessagesWithParts(sessionId).find(
      ({ message }) => message.role === 'assistant' && message.summary === true,
    );
    expect(summary?.message.id).toBe(result.result.summaryMessageId);
    expect(summary?.parts.find((part) => part.type === 'text')).toMatchObject({
      text: '## Summary\n\nCompacted conversation summary.',
    });
  });

  test('uses the session model and provider for compaction', async () => {
    createConversation(sessionId);
    const session = getSession(sessionId);
    expect(session).not.toBeNull();
    const bindings = getJean2CompatibilityBindings();
    bindings.store.updateSession(sessionId, {
      selectedModel: 'custom-model',
      selectedProvider: 'custom-provider',
    });

    await executeCompaction(sessionId, 'manual', noBroadcast, () => {});

    expect(control.requestedModels[0]).toMatchObject({
      modelId: 'custom-model',
      providerId: 'custom-provider',
    });
  });

  test('records a failed compaction and clears compacting state', async () => {
    createConversation(sessionId);
    control.modelFactoryError = new Error('Model unavailable');

    const result = await executeCompaction(sessionId, 'overflow', noBroadcast, () => {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result).toMatchObject({
      error: 'Model unavailable',
      reason: 'overflow',
      skipped: false,
    });
    expect(result.triggerMessageId).toBeString();
    expect(getSession(sessionId)?.compacting).toBe(false);
    const failure = listMessagesWithParts(sessionId).find(
      ({ message }) => message.role === 'assistant' && message.mode === 'compact_failed',
    );
    expect(failure?.message).toMatchObject({
      status: 'error',
      error: 'Model unavailable',
      parentId: result.triggerMessageId,
    });
  });

  test('normalizes non-Error failures', async () => {
    createConversation(sessionId);
    control.modelFactoryError = 'string error';

    const result = await executeCompaction(sessionId, 'manual', noBroadcast, () => {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Compaction failed');
  });

  test('prevents a second compaction while the first is active', async () => {
    createConversation(sessionId);
    let release: (() => void) | undefined;
    control.wait = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = executeCompaction(sessionId, 'manual', noBroadcast, () => {});
    while (!isCompactionActive(sessionId)) await Promise.resolve();
    const second = await executeCompaction(sessionId, 'auto', noBroadcast, () => {});

    expect(second).toEqual({
      ok: false,
      error: 'Compaction is already in progress for this session',
      triggerMessageId: null,
      reason: 'auto',
      skipped: true,
    });
    release?.();
    expect((await first).ok).toBe(true);
    expect(isCompactionActive(sessionId)).toBe(false);
  });
});
