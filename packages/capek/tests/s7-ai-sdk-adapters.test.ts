import { describe, expect, test } from 'bun:test';
import {
  createCapabilityTool,
  createOpenAiResponsesModel,
} from '../src/adapters/ai-sdk';

describe('S7 AI SDK adapters', () => {
  test('creates an MCP-compatible capability tool without changing execution output', async () => {
    const output = { content: [{ type: 'text', text: 'result' }] };
    const tool = createCapabilityTool({
      description: 'MCP tool',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        additionalProperties: false,
      },
      execute: async () => output,
    });

    expect(tool.description).toBe('MCP tool');
    expect(await tool.execute?.({ query: 'test' }, {} as never)).toBe(output);
  });

  test('creates the Codex responses model with pinned provider metadata', () => {
    const result = createOpenAiResponsesModel({
      modelId: 'gpt-5-codex',
      apiKey: 'oauth-token',
      fetch: globalThis.fetch,
      systemPrompt: 'System prompt',
      sessionId: 'session-1',
    });

    expect(result.model).toBeDefined();
    expect(result.useProviderInstructions).toBe(true);
    expect(result.omitMaxOutputTokens).toBe(true);
    expect(result.providerOptions).toEqual({
      openai: {
        instructions: 'System prompt',
        promptCacheKey: 'session-1',
        store: false,
      },
    });
  });
});
