import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import type { AssistantMessage, ToolPart } from '@jean2/sdk';
import { withProviderOverrides } from '@capekai/core/internal/providers';
import { getRuntimeConfiguration, withRuntimeConfiguration } from '@capekai/core/internal/configuration';
import { getRuntimeHost as getJean2CompatibilityBindings, withRuntimeHost as withJean2CompatibilityBindings } from '@capekai/core/internal/hosts';
import { type RuntimeEvent } from '@capekai/core';
import { type ConnectableProvider, type ModelFactoryOptions } from '@capekai/core/internal/providers';
import { getStorage } from '@capekai/core/storage';
import { createRuntime } from '@/bootstrap/create-runtime';
import { executeCompaction, isCompactionActive } from '@capekai/core/internal/execution';
import { convertToAiSdkMessages } from '@capekai/core/internal/execution';
import {
  createMessage,
  createPart,
  createSession,
  createToolOutputArtifact,
  getPart,
  getSession,
  getToolOutputArtifactPage,
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

function installBindings(control: ModelControl): Map<string, ConnectableProvider> {
  createRuntime();
  const model = createCompactionModel(control);
  const createProvider = (id: string) => ({
    descriptor: { id, displayName: id, authType: 'none' as const, connectable: false },
    getStatus: () => ({ provider: id, connected: true }),
    connect: async () => ({}),
    disconnect: async () => {},
    onTokensReceived: async () => {},
    createModel: async (options: ModelFactoryOptions) => {
      control.requestedModels.push(options);
      if (control.modelFactoryError !== undefined) throw control.modelFactoryError;
      return { model };
    },
  });
  return new Map([
    ['openai', createProvider('openai')],
    ['minimax', createProvider('minimax')],
    ['custom-provider', createProvider('custom-provider')],
  ]);
}

function executeWithBindings(
  providers: ReadonlyMap<string, ConnectableProvider>,
  ...args: Parameters<typeof executeCompaction>
): ReturnType<typeof executeCompaction> {
  const bindings = getJean2CompatibilityBindings();
  const runtimeConfiguration = getRuntimeConfiguration();
  return withRuntimeConfiguration(
    {
      ...runtimeConfiguration,
      getCompactionModel: () => undefined,
      getCompactionProvider: () => undefined,
      getCompactionPreserveRecentToolCount: () => 0,
      getCompactionPreserveSmallToolChars: () => 0,
      getCompactionToolClearCharsThreshold: () => 0,
      getCompactionMaxPrunedToolCount: () => 100,
    },
    () => withJean2CompatibilityBindings(
      {
        ...bindings,
        sandbox: { isSandboxActive: () => false },
      },
      () => withProviderOverrides(providers, () => executeCompaction(...args)),
    ),
  );
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

function noBroadcast(_event: RuntimeEvent): void {}

describe('package-owned compaction executor', () => {
  let sessionId: string;
  let workspaceId: string;
  let control: ModelControl;
  let providers: ReadonlyMap<string, ConnectableProvider>;

  beforeEach(() => {
    setupTestDatabase();
    ({ sessionId, workspaceId } = seedWorkspaceWithSession());
    control = { requestedModels: [] };
    providers = installBindings(control);
  });

  afterEach(() => {
    resetTestDatabase();
    createRuntime();
  });

  test('rejects missing and child sessions without starting compaction', async () => {
    const missing = await executeWithBindings(providers, 'missing', 'manual', noBroadcast, () => {});
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
    const childResult = await executeWithBindings(providers, child.id, 'manual', noBroadcast, () => {});
    expect(childResult.ok).toBe(false);
    expect(isCompactionActive(child.id)).toBe(false);
  });

  test('persists summary, usage, state transitions, and reason on success', async () => {
    createConversation(sessionId);
    const sessionUpdates: boolean[] = [];

    const result = await executeWithBindings(
      providers,
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

  test('preserves artifact retrieval after compacting tool output', async () => {
    createConversation(sessionId);
    const assistant = listMessagesWithParts(sessionId).find(({ message }) => message.id === 'assistant-1');
    if (!assistant) throw new Error('Expected assistant message');
    const artifact = createToolOutputArtifact({
      sessionId,
      workspaceId,
      toolCallId: 'call-1',
      toolName: 'read-file',
      content: 'x'.repeat(30_000),
      format: 'text',
    });
    createPart({
      id: 'tool-1',
      messageId: assistant.message.id,
      createdAt: 3,
      type: 'tool',
      callId: 'call-1',
      name: 'read-file',
      state: {
        status: 'completed',
        input: { path: 'large.txt' },
        output: {
          type: 'tool-output-artifact',
          artifactId: artifact.id,
          preview: 'x'.repeat(10_000),
          format: 'text',
          totalChars: artifact.size,
          complete: false,
          message: `Exact output is available with retrieve-tool-output using artifactId ${artifact.id}.`,
        },
        startedAt: 2,
        completedAt: 3,
      },
    } as ToolPart, sessionId);

    const result = await executeWithBindings(providers, sessionId, 'manual', noBroadcast, () => {});

    expect(result.ok).toBe(true);
    const compacted = getPart('tool-1') as ToolPart;
    expect(compacted.state).toHaveProperty('compactedAt');
    expect(getToolOutputArtifactPage(sessionId, artifact.id, 0, 20)?.content).toBe('x'.repeat(20));
    const modelMessages = await convertToAiSdkMessages(listMessagesWithParts(sessionId));
    expect(JSON.stringify(modelMessages)).toContain('[Old tool result content cleared]');
    expect(JSON.stringify(modelMessages)).toContain(artifact.id);
    expect(JSON.stringify(modelMessages)).toContain('retrieve-tool-output');
  });

  test('uses the session model and provider for compaction', async () => {
    createConversation(sessionId);
    const session = getSession(sessionId);
    expect(session).not.toBeNull();
    getStorage().conversation.updateSession(sessionId, {
      selectedModel: 'custom-model',
      selectedProvider: 'custom-provider',
    });

    await executeWithBindings(providers, sessionId, 'manual', noBroadcast, () => {});

    expect(control.requestedModels[0]).toMatchObject({
      modelId: 'custom-model',
      providerId: 'custom-provider',
    });
  });

  test('records a failed compaction and clears compacting state', async () => {
    createConversation(sessionId);
    control.modelFactoryError = new Error('Model unavailable');

    const result = await executeWithBindings(providers, sessionId, 'overflow', noBroadcast, () => {});

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

    const result = await executeWithBindings(providers, sessionId, 'manual', noBroadcast, () => {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Compaction failed');
  });

  test('prevents a second compaction while the first is active', async () => {
    createConversation(sessionId);
    let release: (() => void) | undefined;
    control.wait = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = executeWithBindings(providers, sessionId, 'manual', noBroadcast, () => {});
    while (!isCompactionActive(sessionId)) await Promise.resolve();
    const second = await executeWithBindings(providers, sessionId, 'auto', noBroadcast, () => {});

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
