import { describe, expect, test } from 'bun:test';
import type { MessageWithParts } from '@prokopai/sdk';
import type { ToolCatalogEntry, ToolCatalogPort } from '@/application/ports/tool-catalog';
import { projectMessagesForClient } from '@/application/sessions/tool-debug';

function makeTranscript(): MessageWithParts[] {
  return [{
    message: {
      id: 'message-1',
      sessionId: 'session-1',
      role: 'assistant',
      status: 'completed',
      modelId: 'model-1',
      providerId: 'provider-1',
      tokens: { prompt: 0, completion: 0 },
      cost: 0,
      createdAt: 1,
    },
    parts: [{
      id: 'part-1',
      messageId: 'message-1',
      createdAt: 1,
      type: 'tool',
      callId: 'call-1',
      name: 'shell',
      state: {
        status: 'completed',
        input: { command: 'echo secret-input' },
        output: {
          success: true,
          content: 'secret-output',
          _visualization: {
            type: 'shell-output',
            command: 'echo secret-input',
            stdout: 'visible result',
            stderr: '',
            exitCode: 0,
          },
        },
        startedAt: 1,
        completedAt: 2,
      },
    }],
  }];
}

const catalog: Pick<ToolCatalogPort, 'listTools'> = {
  async listTools() {
    return [{
      name: 'shell',
      display: { summary: '{command}' },
      source: 'builtin',
    }] as ToolCatalogEntry[];
  },
};

describe('tool debug transcript projection', () => {
  test('omits raw input and output while preserving summary and visualization', async () => {
    const original = makeTranscript();
    const projected = await projectMessagesForClient(original, catalog);
    const part = projected[0].parts[0];

    expect(part.type).toBe('tool');
    if (part.type !== 'tool') throw new Error('Expected tool part');
    expect(part.presentation).toEqual({
      summary: 'echo secret-input',
      visualization: {
        type: 'shell-output',
        command: 'echo secret-input',
        stdout: 'visible result',
        stderr: '',
        exitCode: 0,
      },
      debugAvailable: true,
    });
    expect(part.state.input).toEqual({});
    expect(part.state.status).toBe('completed');
    if (part.state.status !== 'completed') throw new Error('Expected completed tool');
    expect(part.state.output).toEqual({
      _visualization: part.presentation?.visualization,
    });

    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain('secret-output');
    expect(serialized).not.toContain('content');
    expect(original[0].parts[0]).not.toBe(part);
  });

  test('falls back to a bounded input summary when the catalog is unavailable', async () => {
    const projected = await projectMessagesForClient(makeTranscript());
    const part = projected[0].parts[0];
    if (part.type !== 'tool') throw new Error('Expected tool part');

    expect(part.presentation?.summary).toBe('{"command":"echo secret-input"}');
  });
});
