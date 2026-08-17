import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SandboxLanguageModel, sandboxController, type SandboxResponse } from '@capekai/core/internal/sandbox';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';

function createCallOptions() {
  return {
    prompt: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello sandbox' },
    ],
    tools: undefined,
  };
}

async function collectStreamChunks(response: SandboxResponse): Promise<unknown[]> {
  const model = new SandboxLanguageModel({
    sessionId: 'session-1',
    modelId: 'sandbox-model',
    providerId: 'sandbox',
  });

  const streamPromise = model.doStream(createCallOptions());
  await Promise.resolve();

  const pendingCall = sandboxController.getPendingCalls()[0];
  expect(pendingCall).toBeDefined();
  sandboxController.respond(pendingCall!.callId, response);

  const result = await streamPromise;
  const reader = result.stream.getReader();
  const chunks: unknown[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
  }

  return chunks;
}

describe('SandboxLanguageModel', () => {
  beforeEach(() => {
    setupTestDatabase();
    sandboxController.reset();
  });

  afterEach(() => {
    sandboxController.reset();
    resetTestDatabase();
  });

  test('converts text responses into AI SDK text deltas', async () => {
    const chunks = await collectStreamChunks({
      type: 'text',
      content: 'Hello from sandbox',
    });

    expect(chunks).toHaveLength(5);

    const [start, firstDelta, secondDelta, end, finish] = chunks as Array<Record<string, unknown>>;
    expect(start.type).toBe('text-start');
    expect(typeof start.id).toBe('string');

    expect(firstDelta).toEqual({
      type: 'text-delta',
      id: start.id,
      delta: 'Hello fro',
    });
    expect(secondDelta).toEqual({
      type: 'text-delta',
      id: start.id,
      delta: 'm sandbox',
    });

    expect(end).toEqual({
      type: 'text-end',
      id: start.id,
    });

    expect(finish).toEqual({
      type: 'finish',
      finishReason: { unified: 'stop', raw: undefined },
      logprobs: undefined,
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
    });
  });

  test('converts reasoning responses into reasoning and text deltas', async () => {
    const chunks = await collectStreamChunks({
      type: 'reasoning',
      reasoning: 'step by step',
      text: 'final answer',
    });

    expect(chunks).toHaveLength(7);

    const [reasoningStart, reasoningDelta, reasoningEnd, textStart, textDelta, textEnd, finish] = chunks as Array<Record<string, unknown>>;
    expect(reasoningStart.type).toBe('reasoning-start');
    expect(typeof reasoningStart.id).toBe('string');
    expect(reasoningDelta).toEqual({
      type: 'reasoning-delta',
      id: reasoningStart.id,
      delta: 'step by step',
    });
    expect(reasoningEnd).toEqual({
      type: 'reasoning-end',
      id: reasoningStart.id,
    });

    expect(textStart.type).toBe('text-start');
    expect(typeof textStart.id).toBe('string');
    expect(textDelta).toEqual({
      type: 'text-delta',
      id: textStart.id,
      delta: 'final answer',
    });
    expect(textEnd).toEqual({
      type: 'text-end',
      id: textStart.id,
    });

    expect(finish).toEqual({
      type: 'finish',
      finishReason: { unified: 'stop', raw: undefined },
      logprobs: undefined,
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
    });
  });

  test('converts tool-call responses into AI SDK tool-call deltas', async () => {
    const chunks = await collectStreamChunks({
      type: 'tool-call',
      toolName: 'read-file',
      args: { path: '/tmp/test.txt' },
      toolCallId: 'tool-1',
    });

    expect(chunks).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'tool-1',
        toolName: 'read-file',
        input: '{"path":"/tmp/test.txt"}',
      },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: undefined },
        logprobs: undefined,
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
      },
    ]);
  });

  test('converts multi-tool-call responses into multiple tool-call deltas', async () => {
    const chunks = await collectStreamChunks({
      type: 'multi-tool-call',
      calls: [
        {
          toolName: 'read-file',
          args: { path: '/tmp/a.txt' },
          toolCallId: 'tool-1',
        },
        {
          toolName: 'glob',
          args: { pattern: '**/*.ts' },
          toolCallId: 'tool-2',
        },
      ],
    });

    expect(chunks).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'tool-1',
        toolName: 'read-file',
        input: '{"path":"/tmp/a.txt"}',
      },
      {
        type: 'tool-call',
        toolCallId: 'tool-2',
        toolName: 'glob',
        input: '{"pattern":"**/*.ts"}',
      },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: undefined },
        logprobs: undefined,
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
      },
    ]);
  });

  test('throws for error responses in doStream', async () => {
    const model = new SandboxLanguageModel({
      sessionId: 'session-1',
      modelId: 'sandbox-model',
      providerId: 'sandbox',
    });

    const streamPromise = model.doStream(createCallOptions());
    await Promise.resolve();

    const pendingCall = sandboxController.getPendingCalls()[0];
    expect(pendingCall).toBeDefined();
    sandboxController.respond(pendingCall!.callId, {
      type: 'error',
      error: 'sandbox boom',
    });

    await expect(streamPromise).rejects.toThrow('sandbox boom');
  });

  test('converts text responses for doGenerate', async () => {
    const model = new SandboxLanguageModel({
      sessionId: 'session-1',
      modelId: 'sandbox-model',
      providerId: 'sandbox',
    });

    const generatePromise = model.doGenerate(createCallOptions());
    await Promise.resolve();

    const pendingCall = sandboxController.getPendingCalls()[0];
    expect(pendingCall).toBeDefined();
    sandboxController.respond(pendingCall!.callId, {
      type: 'text',
      content: 'generated text',
    });

    await expect(generatePromise).resolves.toEqual({
      content: [{ type: 'text', text: 'generated text' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    });
  });
});
