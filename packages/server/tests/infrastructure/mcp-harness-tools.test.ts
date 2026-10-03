import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createClaudeWorkspaceMcp } from '@/harnesses/claude-cli/mcp-tools';
import { createCodexMcpTools } from '@/harnesses/codex-cli/mcp-tools';
import type { WorkspaceMcpTool } from '@/application/ports/mcp-tools';

describe('harness MCP adapters', () => {
  test('Claude preserves raw schemas and result content and denies after cancellation', async () => {
    const controller = new AbortController();
    let calls = 0;
    const tool: WorkspaceMcpTool = { name: 'mcp_fixture', serverName: 'crm', toolName: 'read',
      description: 'Read', inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      execute: async input => { calls++; return { content: [{ type: 'text', text: String(input.id) }], structuredContent: { id: input.id } }; } };
    const config = createClaudeWorkspaceMcp([tool], controller.signal, () => true)!;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1' });
    await config.instance.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools[0]?.inputSchema).toEqual({ type: 'object', ...tool.inputSchema });
      expect(await client.callTool({ name: tool.name, arguments: { id: 7 } })).toMatchObject({ structuredContent: { id: 7 } });
      controller.abort();
      expect((await client.listTools()).tools).toEqual([]);
      expect(await client.callTool({ name: tool.name, arguments: {} })).toMatchObject({ isError: true });
      expect(calls).toBe(1);
    } finally { await client.close(); await config.instance.close(); }
  });
  test('Codex discovers fresh policy, rejects malformed and replayed calls, and checks turn ownership', async () => {
    let active = true;
    let enabled = true;
    let calls = 0;
    const tool: WorkspaceMcpTool = { name: 'crm_read', serverName: 'crm', toolName: 'read', description: 'Read',
      inputSchema: { type: 'object' }, execute: async () => { calls++; return { content: [{ type: 'text', text: 'ok' }] }; } };
    const adapter = createCodexMcpTools({ bridge: { tools: async () => enabled ? [tool] : [] },
      path: '/workspace', authorized: id => active && id === 'turn' });
    const request = (callId: string, name = 'mcp_call_tool', args: unknown = { tool: 'crm_read', arguments: {} }) =>
      ({ namespace: null, turnId: 'turn', callId, tool: name, arguments: args });
    expect((await adapter.call(request('list', 'mcp_list_tools', {}))).contentItems[0]?.text).toContain('crm_read');
    expect((await adapter.call(request('one'))).success).toBe(true);
    expect((await adapter.call(request('one'))).success).toBe(false);
    enabled = false;
    expect((await adapter.call(request('two'))).success).toBe(false);
    enabled = true;
    expect((await adapter.call(request('three', 'mcp_call_tool', { tool: 'crm_read', arguments: [] }))).success).toBe(false);
    active = false;
    expect((await adapter.call(request('four'))).success).toBe(false);
    expect(calls).toBe(1);
  });
});
