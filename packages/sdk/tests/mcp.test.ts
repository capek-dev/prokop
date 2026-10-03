import { afterEach, expect, mock, test } from 'bun:test';
import { McpRestNamespace } from '../src/rest/mcp';
import { HttpClient } from '../src/transport/http';
import { TypedEventEmitter } from '../src/emitter';
import { routeServerMessage, type SdkEventMap } from '../src/types/server-messages';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test.each(['ws/1', null])('MCP APIs isolate scope %s and encode server identities', async scope => {
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ success: true, tools: [] });
  }) as typeof fetch;
  const mcp = new McpRestNamespace(new HttpClient({ url: 'https://host.test' }));
  await mcp.save(scope, 'crm name', { type: 'remote', url: 'https://crm.test/mcp' });
  await mcp.getTools(scope, 'crm name');
  await mcp.setToolEnabled(scope, 'crm name', 'delete', false);
  await mcp.remove(scope, 'crm name');
  const base = scope === null ? 'https://host.test/api/mcp' : 'https://host.test/api/workspaces/ws%2F1/mcp';
  expect(calls.map(call => call.url)).toEqual([
    `${base}/servers`,
    `${base}/tools?name=crm%20name`,
    `${base}/tools`,
    `${base}/remove`,
  ]);
  expect(calls[2]?.body).toEqual({ name: 'crm name', toolName: 'delete', enabled: false });
});
test('MCP changes reach SDK subscribers', () => {
  const emitter = new TypedEventEmitter<SdkEventMap>();
  const handler = mock(() => {});
  emitter.on('mcp.changed', handler);
  routeServerMessage(emitter, { type: 'mcp.changed', workspaceId: 'ws' });
  expect(handler).toHaveBeenCalledWith('ws');
  routeServerMessage(emitter, { type: 'mcp.changed', workspaceId: null });
  expect(handler).toHaveBeenCalledWith(null);
});
