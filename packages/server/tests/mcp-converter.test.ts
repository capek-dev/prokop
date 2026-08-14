import { describe, expect, test } from 'bun:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import { convertMcpTool } from '@/mcp/converter';

const definition: MCPTool = {
  name: 'large-output',
  description: 'Returns a large result',
  inputSchema: { type: 'object', properties: {} },
};

describe('MCP tool conversion', () => {
  test('returns raw large output for the composed artifact policy', async () => {
    const result = {
      content: [{ type: 'text' as const, text: 'x'.repeat(60_000) }],
    };
    const client = {
      callTool: async () => result,
    } as unknown as Client;
    const converted = await convertMcpTool(definition, client, 'server', 30_000, 'session-1');
    const execute = converted.execute as (...args: unknown[]) => Promise<unknown>;

    const output = await execute({});

    expect(output).toBe(result);
    expect(JSON.stringify(output)).toHaveLength(JSON.stringify(result).length);
    expect(output).not.toHaveProperty('_filePath');
    expect(output).not.toHaveProperty('_persisted');
  });
});
