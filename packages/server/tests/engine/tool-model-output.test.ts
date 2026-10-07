import { describe, expect, test } from 'bun:test';
import type { MessageWithParts, ToolModelOutputPart, ToolPart } from '@prokopai/sdk/types';
import { convertToAiSdkMessages } from '@/harnesses/prokop/execution/message-utils';
import { createStreamHandlers } from '@/harnesses/prokop/execution/stream-handlers';
import { buildExternalTools } from '@/harnesses/prokop/execution/tool-builders/external-tools';
import { createInMemoryStorageBundle } from '@/infrastructure/storage/memory';
import { configureStorage, createMessage, createPart, createSession, getPart } from '@/infrastructure/storage/runtime';
import { withToolRegistryResolver } from '@/infrastructure/tools/registry';
import {
  capekToolOutputToAiSdk,
  createCapekToolOutputEnvelope,
  isCapekToolOutputEnvelope,
  normalizeToolModelOutput,
} from '@/infrastructure/tools/model-output';

const image: ToolModelOutputPart = {
  type: 'image',
  data: 'aGVsbG8=',
  mediaType: 'image/png',
};

describe('tool model output', () => {
  test('maps neutral text and image parts to AI SDK content output', () => {
    const envelope = createCapekToolOutputEnvelope(
      { captured: true },
      [{ type: 'text', text: 'Screenshot' }, image],
    );

    expect(isCapekToolOutputEnvelope(envelope)).toBe(true);
    expect(capekToolOutputToAiSdk(envelope)).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'Screenshot' },
        { type: 'image-data', data: 'aGVsbG8=', mediaType: 'image/png' },
      ],
    });
  });

  test('installs the model-output converter on standard tool bridges', async () => {
    const loadedTool = {
      definition: {
        name: 'screenshot',
        description: 'Capture a screenshot',
        inputSchema: { type: 'object', properties: {} },
      },
      path: 'builtin:test',
      execute: async () => ({
        success: true,
        result: { captured: true },
        modelOutput: [image],
      }),
    };
    const tools = await withToolRegistryResolver({
      get: (name) => name === 'screenshot' ? loadedTool : null,
      list: () => [loadedTool],
    }, () => buildExternalTools({
      toolNames: ['screenshot'],
      broadcast: () => {},
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      workspacePath: '/tmp',
      rootSessionId: 'session-1',
      executionScopes: new Set(),
    }));
    const toModelOutput = tools.screenshot.toModelOutput;
    expect(toModelOutput).toBeFunction();
    expect(await toModelOutput?.({
      toolCallId: 'call-1',
      input: {},
      output: createCapekToolOutputEnvelope({ captured: true }, [image]),
    })).toEqual({
      type: 'content',
      value: [{ type: 'image-data', data: 'aGVsbG8=', mediaType: 'image/png' }],
    });
  });

  test('rejects malformed image output and preserves the existing JSON fallback', () => {
    expect(normalizeToolModelOutput([{ type: 'image', data: 'data:image/png;base64,aGVsbG8=', mediaType: 'image/png' }]))
      .toBeUndefined();
    expect(normalizeToolModelOutput([{ type: 'image', data: 'aGVsbG8=', mediaType: 'text/plain' }]))
      .toBeUndefined();
    expect(capekToolOutputToAiSdk({ captured: true })).toEqual({
      type: 'json',
      value: { captured: true },
    });
  });

  test('rebuilds persisted model image output in later conversation turns', async () => {
    const messages = [{
      message: {
        id: 'message-1',
        sessionId: 'session-1',
        role: 'assistant' as const,
        createdAt: 1,
        status: 'completed' as const,
        modelId: 'test-model',
        providerId: 'test-provider',
        tokens: { prompt: 0, completion: 0 },
        cost: 0,
      },
      parts: [{
        id: 'part-1',
        messageId: 'message-1',
        createdAt: 1,
        type: 'tool' as const,
        callId: 'call-1',
        name: 'screenshot',
        state: {
          status: 'completed' as const,
          input: {},
          output: { captured: true },
          modelOutput: [image],
          startedAt: 1,
          completedAt: 2,
        },
      }],
    }] satisfies MessageWithParts[];

    const converted = await convertToAiSdkMessages(messages);
    expect(converted).toHaveLength(2);
    expect(converted[1]).toEqual({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'screenshot',
        output: {
          type: 'content',
          value: [{ type: 'image-data', data: 'aGVsbG8=', mediaType: 'image/png' }],
        },
      }],
    });
  });

  test('stores client output and model output separately when a tool completes', async () => {
    configureStorage(createInMemoryStorageBundle());
    await createSession({
      id: 'session-1',
      workspaceId: 'workspace-1',
      preconfigId: null,
      title: 'Test',
      status: 'active',
      metadata: null,
      parentId: null,
      agentName: null,
    });
    await createMessage({
      id: 'message-1',
      sessionId: 'session-1',
      role: 'assistant',
      createdAt: 1,
      status: 'streaming',
      modelId: 'test-model',
      providerId: 'test-provider',
      tokens: { prompt: 0, completion: 0 },
      cost: 0,
    });
    const toolPart: ToolPart = {
      id: 'part-1',
      messageId: 'message-1',
      createdAt: 1,
      type: 'tool',
      callId: 'call-1',
      name: 'screenshot',
      state: { status: 'pending', input: {} },
    };
    await createPart(toolPart, 'session-1');
    const handlers = createStreamHandlers({
      messageId: 'message-1',
      sessionId: 'session-1',
      toolParts: [toolPart],
      currentText: '',
      currentTextPartId: null,
      currentTextCreatedAt: null,
      currentReasoning: '',
      currentReasoningPartId: null,
      currentReasoningCreatedAt: null,
      yieldFn: () => {},
    });

    await handlers.handleToolResult({
      toolCallId: 'call-1',
      output: createCapekToolOutputEnvelope({ captured: true }, [image]),
    });

    const stored = await getPart('part-1') as ToolPart;
    expect(stored.state).toMatchObject({
      status: 'completed',
      output: { captured: true },
      modelOutput: [image],
    });
  });
});
