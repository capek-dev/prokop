import { afterEach, expect, mock, test } from 'bun:test';
import { McpRestNamespace } from '../src/rest/mcp';
import { HttpClient } from '../src/transport/http';
import { TypedEventEmitter } from '../src/emitter';
import { routeServerMessage, type SdkEventMap } from '../src/types/server-messages';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('MCP configuration and tool APIs encode workspace and server identities', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ success: true, tools: [] });
  }) as typeof fetch;
  const mcp = new McpRestNamespace(new HttpClient({ url: 'https://host.test' }));
  await mcp.save('ws/1', 'crm name', { type: 'remote', url: 'https://crm.test/mcp' });
  await mcp.getTools('ws/1', 'crm name');
  await mcp.setToolEnabled('ws/1', 'crm name', 'delete', false);
  await mcp.remove('ws/1', 'crm name');
  expect(calls.map(call => call.url)).toEqual([
    'https://host.test/api/workspaces/ws%2F1/mcp/servers',
    'https://host.test/api/workspaces/ws%2F1/mcp/tools?name=crm%20name',
    'https://host.test/api/workspaces/ws%2F1/mcp/tools',
    'https://host.test/api/workspaces/ws%2F1/mcp/remove',
  ]);
  expect(calls[2]?.body).toEqual({ name: 'crm name', toolName: 'delete', enabled: false });
});
test('MCP changes reach SDK subscribers', () => {
  const emitter = new TypedEventEmitter<SdkEventMap>();
  const handler = mock(() => {});
  emitter.on('mcp.changed', handler);
  routeServerMessage(emitter, { type: 'mcp.changed', workspaceId: 'ws' });
  expect(handler).toHaveBeenCalledWith('ws');
});
