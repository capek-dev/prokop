import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { convertToAiSdkMessages } from '@/core/message-utils';
import type { MessageWithParts, AssistantMessage, ToolPart, CompactionPart } from '@jean2/sdk';

describe('convertToAiSdkMessages', () => {
  beforeEach(() => {
    setupTestDatabase();
    seedWorkspaceWithSession();
  });

  afterEach(() => {
    resetTestDatabase();
  });

  test('converts simple text user message', async () => {
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm1', sessionId: 's1', role: 'user', createdAt: 0 },
        parts: [{ id: 'p1', messageId: 'm1', createdAt: 0, type: 'text', text: 'Hello' }],
      },
    ];

    const result = await convertToAiSdkMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
  });

  test('converts simple text assistant message', async () => {
    const messages: MessageWithParts[] = [
      {
        message: {
          id: 'm1', sessionId: 's1', role: 'assistant', createdAt: 0,
          status: 'completed', modelId: 'gpt-4o', providerId: 'openai',
          tokens: { prompt: 0, completion: 0 }, cost: 0,
        },
        parts: [{ id: 'p1', messageId: 'm1', createdAt: 0, type: 'text', text: 'Hi there' }],
      },
    ];

    const result = await convertToAiSdkMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
  });

  test('skips compact_failed messages', async () => {
    const messages: MessageWithParts[] = [
      {
        message: {
          id: 'm1', sessionId: 's1', role: 'assistant', createdAt: 0,
          status: 'error', modelId: 'x', providerId: 'y',
          tokens: { prompt: 0, completion: 0 }, cost: 0,
          mode: 'compact_failed',
        } as AssistantMessage,
        parts: [{ id: 'p1', messageId: 'm1', createdAt: 0, type: 'text', text: 'failed' }],
      },
    ];

    const result = await convertToAiSdkMessages(messages);
    expect(result).toHaveLength(0);
  });

  test('converts compaction trigger to user question', async () => {
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm1', sessionId: 's1', role: 'user', createdAt: 0 },
        parts: [{
          id: 'p1', messageId: 'm1', createdAt: 0, type: 'compaction',
          auto: true, overflow: false,
        } as CompactionPart],
      },
    ];

    const result = await convertToAiSdkMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
  });

  test('non-overflow compaction trigger asks "What did we do so far?"', async () => {
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm1', sessionId: 's1', role: 'user', createdAt: 0 },
        parts: [{
          id: 'p1', messageId: 'm1', createdAt: 0, type: 'compaction',
          auto: true, overflow: false,
        } as CompactionPart],
      },
    ];

    const result = await convertToAiSdkMessages(messages);
    const content = result[0].content as string;
    expect(content).toContain('What did we do so far?');
  });

  test('overflow compaction trigger asks to continue', async () => {
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm1', sessionId: 's1', role: 'user', createdAt: 0 },
        parts: [{
          id: 'p1', messageId: 'm1', createdAt: 0, type: 'compaction',
          auto: true, overflow: true,
        } as CompactionPart],
      },
    ];

    const result = await convertToAiSdkMessages(messages);
    const content = result[0].content as string;
    expect(content).toContain('Continue');
  });

  test('handles tool call + tool result pairs for completed tools', async () => {
    const messages: MessageWithParts[] = [
      {
        message: {
          id: 'm1', sessionId: 's1', role: 'assistant', createdAt: 0,
          status: 'completed', modelId: 'gpt-4o', providerId: 'openai',
          tokens: { prompt: 0, completion: 0 }, cost: 0,
        },
        parts: [{
          id: 'p1', messageId: 'm1', createdAt: 0, type: 'tool', callId: 'call-1',
          name: 'read-file',
          state: {
            status: 'completed',
            input: { path: '/test' },
            output: 'file contents',
            startedAt: 100,
            completedAt: 200,
          },
        } as ToolPart],
      },
    ];

    const result = await convertToAiSdkMessages(messages);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].role).toBe('assistant');
    expect(result[1].role).toBe('tool');
  });

  test('preserves legacy temporary-file artifact fields for non-compacted rows', async () => {
    const legacyOutput = {
      content: 'legacy preview',
      _persisted: true,
      _filePath: '/tmp/jean2/session-1/read-file-1.json',
      _originalSize: 60_000,
    };
    const messages: MessageWithParts[] = [{
      message: {
        id: 'm1', sessionId: 's1', role: 'assistant', createdAt: 0,
        status: 'completed', modelId: 'gpt-4o', providerId: 'openai',
        tokens: { prompt: 0, completion: 0 }, cost: 0,
      },
      parts: [{
        id: 'p1', messageId: 'm1', createdAt: 0, type: 'tool', callId: 'call-1',
        name: 'read-file',
        state: {
          status: 'completed',
          input: {},
          output: legacyOutput,
          startedAt: 100,
          completedAt: 200,
        },
      } as ToolPart],
    }];

    const result = await convertToAiSdkMessages(messages);
    const toolResult = result.find(entry => entry.role === 'tool');
    const content = toolResult?.content as Array<{ type: string; output?: { value?: unknown } }>;
    expect(content.find(entry => entry.type === 'tool-result')?.output?.value).toEqual(legacyOutput);
  });

  test('compacted tool outputs show "[Old tool result content cleared]"', async () => {
    const messages: MessageWithParts[] = [
      {
        message: {
          id: 'm1', sessionId: 's1', role: 'assistant', createdAt: 0,
          status: 'completed', modelId: 'gpt-4o', providerId: 'openai',
          tokens: { prompt: 0, completion: 0 }, cost: 0,
        },
        parts: [{
          id: 'p1', messageId: 'm1', createdAt: 0, type: 'tool', callId: 'call-1',
          name: 'read-file',
          state: {
            status: 'completed',
            input: {},
            output: 'big data',
            startedAt: 100,
            completedAt: 200,
            compactedAt: 12345,
          },
        } as ToolPart],
      },
    ];

    const result = await convertToAiSdkMessages(messages);
    const toolResult = result.find(r => r.role === 'tool');
    expect(toolResult).toBeDefined();
    const content = toolResult!.content as Array<{ type: string; output?: unknown }>;
    const toolResultBlock = content.find((c: Record<string, unknown>) => c.type === 'tool-result');
    expect(toolResultBlock).toBeDefined();
    expect((toolResultBlock?.output as { value: unknown }).value).toBe('[Old tool result content cleared]');
  });

  test('compacted artifact outputs preserve the legacy marker and retrieval reference', async () => {
    const artifactId = '123e4567-e89b-42d3-a456-426614174000';
    const messages: MessageWithParts[] = [{
      message: {
        id: 'm1', sessionId: 's1', role: 'assistant', createdAt: 0,
        status: 'completed', modelId: 'gpt-4o', providerId: 'openai',
        tokens: { prompt: 0, completion: 0 }, cost: 0,
      },
      parts: [{
        id: 'p1', messageId: 'm1', createdAt: 0, type: 'tool', callId: 'call-1',
        name: 'read-file',
        state: {
          status: 'completed',
          input: {},
          output: {
            type: 'tool-output-artifact',
            artifactId,
            preview: 'preview',
            format: 'text',
            totalChars: 60_000,
            complete: false,
            message: 'retrievable',
            _visualization: { type: 'none' },
          },
          startedAt: 100,
          completedAt: 200,
          compactedAt: 12345,
        },
      } as ToolPart],
    }];

    const result = await convertToAiSdkMessages(messages);
    const toolResult = result.find(entry => entry.role === 'tool');
    const content = toolResult?.content as Array<{ type: string; output?: { value?: unknown } }>;
    const value = content.find(entry => entry.type === 'tool-result')?.output?.value as Record<string, unknown>;
    expect(value.artifactId).toBe(artifactId);
    expect(value.preview).toBe('[Old tool result content cleared]');
    expect(value.message).toContain('retrieve-tool-output');
    expect(value.message).toContain(artifactId);
    expect(value).not.toHaveProperty('_visualization');
  });

  test('pending/running/interrupted tools synthesize error results', async () => {
    for (const status of ['pending', 'running', 'interrupted'] as const) {
      const messages: MessageWithParts[] = [
        {
          message: {
            id: 'm1', sessionId: 's1', role: 'assistant', createdAt: 0,
            status: 'completed', modelId: 'gpt-4o', providerId: 'openai',
            tokens: { prompt: 0, completion: 0 }, cost: 0,
          },
          parts: [{
            id: 'p1', messageId: 'm1', createdAt: 0, type: 'tool', callId: 'call-1',
            name: 'read-file',
            state: {
              status,
              input: {},
              ...(status === 'running' ? { startedAt: 100 } : {}),
              ...(status === 'interrupted' ? { startedAt: 100, interruptedAt: 200, reason: 'user_request' as const } : {}),
            },
          } as ToolPart],
        },
      ];

      const result = await convertToAiSdkMessages(messages);
      const toolResult = result.find(r => r.role === 'tool');
      expect(toolResult, `status=${status}: expected tool result`).toBeDefined();
    }
  });

  test('error tools produce tool-result with error', async () => {
    const messages: MessageWithParts[] = [
      {
        message: {
          id: 'm1', sessionId: 's1', role: 'assistant', createdAt: 0,
          status: 'completed', modelId: 'gpt-4o', providerId: 'openai',
          tokens: { prompt: 0, completion: 0 }, cost: 0,
        },
        parts: [{
          id: 'p1', messageId: 'm1', createdAt: 0, type: 'tool', callId: 'call-1',
          name: 'bash',
          state: {
            status: 'error',
            input: { command: 'rm -rf /' },
            error: 'Permission denied',
            startedAt: 100,
            failedAt: 200,
          },
        } as ToolPart],
      },
    ];

    const result = await convertToAiSdkMessages(messages);
    const toolResult = result.find(r => r.role === 'tool');
    expect(toolResult).toBeDefined();
  });

  test('skill tool outputs are NOT cleared even when compacted', async () => {
    const messages: MessageWithParts[] = [
      {
        message: {
          id: 'm1', sessionId: 's1', role: 'assistant', createdAt: 0,
          status: 'completed', modelId: 'gpt-4o', providerId: 'openai',
          tokens: { prompt: 0, completion: 0 }, cost: 0,
        },
        parts: [{
          id: 'p1', messageId: 'm1', createdAt: 0, type: 'tool', callId: 'call-1',
          name: 'skill',
          state: {
            status: 'completed',
            input: { name: 'shadcn' },
            output: { result: 'component added' },
            startedAt: 100,
            completedAt: 200,
            compactedAt: 12345,
          },
        } as ToolPart],
      },
    ];

    const result = await convertToAiSdkMessages(messages);
    const toolResult = result.find(r => r.role === 'tool');
    expect(toolResult).toBeDefined();
    const content = toolResult!.content as Array<{ type: string; output?: unknown }>;
    const toolResultBlock = content.find((c: Record<string, unknown>) => c.type === 'tool-result');
    expect(toolResultBlock).toBeDefined();
    // Skill tools with compactedAt should still have real output, not the "cleared" marker
    const output = (toolResultBlock as Record<string, unknown>).output;
    expect(output).toBeDefined();
    // The output should NOT be the "[Old tool result content cleared]" placeholder
    if (output && typeof output === 'object' && 'value' in output) {
      expect((output as { value: unknown }).value).not.toBe('[Old tool result content cleared]');
    }
  });

  test('skips messages with no content parts', async () => {
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm1', sessionId: 's1', role: 'user', createdAt: 0 },
        parts: [], // No parts at all
      },
    ];

    const result = await convertToAiSdkMessages(messages);
    expect(result).toHaveLength(0);
  });

  test('handles multiple text parts by joining with double newline', async () => {
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm1', sessionId: 's1', role: 'user', createdAt: 0 },
        parts: [
          { id: 'p1', messageId: 'm1', createdAt: 0, type: 'text', text: 'Hello' },
          { id: 'p2', messageId: 'm1', createdAt: 1, type: 'text', text: 'World' },
        ],
      },
    ];

    const result = await convertToAiSdkMessages(messages);
    expect(result).toHaveLength(1);
    const content = result[0].content as string;
    expect(content).toBe('Hello\n\nWorld');
  });

  test('handles mixed text and compaction parts', async () => {
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm1', sessionId: 's1', role: 'user', createdAt: 0 },
        parts: [
          { id: 'p1', messageId: 'm1', createdAt: 0, type: 'compaction', auto: false, overflow: false } as CompactionPart,
          { id: 'p2', messageId: 'm1', createdAt: 1, type: 'text', text: 'Additional context' },
        ],
      },
    ];

    const result = await convertToAiSdkMessages(messages);
    expect(result).toHaveLength(1);
    const content = result[0].content as string;
    expect(content).toContain('What did we do so far?');
    expect(content).toContain('Additional context');
  });
});
