import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_BROWSER_MCP_NAME, type AskRequestMessage, type ServerMessage } from '@prokopai/sdk';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { getPermissionRequestByRequestId } from '@/infrastructure/sqlite/pending-asks';
import { Paths } from '@/infrastructure/runtime/paths';
import { browserService } from '@/infrastructure/browser/service';
import { browserTools, validateBrowserInput } from '@/infrastructure/browser/catalog';
import { createMcpManager } from '@/infrastructure/mcp/manager';
import { getTools } from '@/infrastructure/mcp/converter';
import { createCodexMcpTools } from '@/harnesses/codex-cli/mcp-tools';
import { createClaudeWorkspaceMcp } from '@/harnesses/claude-cli/mcp-tools';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { installBrowserRequestsPort } from '@/application/ports/browser';
import { handleClientRegistration, registerConnection, unregisterConnection } from '@/transport/websocket/connection-registry';
import { handleClaim, removeSessionControl } from '@/transport/websocket/control-registry';
import { installDeliveryPort } from '@/transport/websocket/broadcast';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { handleAskResponse } from '@/transport/websocket/handlers/misc';
import type { RouterContext } from '@/transport/websocket/router-context';

let root: string;
let sockets: object[];
let requests: Array<{ connection?: ConnectionId; message: AskRequestMessage }>;
let manager: ReturnType<typeof createMcpManager>;
let abort: AbortController;
let extension: ConnectionId;
let onRequest: ((message: AskRequestMessage) => void) | undefined;
function connect(clientId: string, type: 'extension' | 'web'): ConnectionId {
  const socket = {}; sockets.push(socket);
  const connection = registerConnection(socket);
  handleClientRegistration(connection, { type: 'client.register', client: { clientId, clientType: type,
    displayName: clientId, interactionMode: type === 'extension' ? 'headless' : 'human',
    capabilities: type === 'extension' ? ['browser_automation', 'active_tab_read', ...browserTools.map(tool => tool.definition.name)] : [] } }, () => {});
  return connection;
}
beforeEach(async () => {
  setupTestDatabase();
  root = await mkdtemp(join(tmpdir(), 'browser-mcp-'));
  Paths.configure({ dataDir: join(root, 'global') });
  seedWorkspace({ id: 'ws', path: root });
  sockets = []; requests = []; onRequest = undefined; abort = new AbortController();
  manager = createMcpManager();
  installBrowserRequestsPort(browserService);
  const capture = (message: ServerMessage, connection?: ConnectionId) => {
    if (message.type === 'ask.request') { requests.push({ message, connection }); onRequest?.(message); }
  };
  installDeliveryPort({ sendToConnection: (id, message) => capture(message, id),
    sendToAskTargets: (_id, _authority, message) => capture(message), broadcast: () => {},
    broadcastToSession: () => {}, sendToController: () => {} });
  extension = connect('extension', 'extension');
  createSession({ id: 'session', workspaceId: 'ws', title: 'Browser', status: 'active',
    permissionMode: 'standard', preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'prokop' });
  handleClaim('session', connect('controller', 'web'));
});
afterEach(async () => {
  abort.abort();
  removeSessionControl('session');
  removeSessionControl('other-session');
  for (const socket of sockets) unregisterConnection(socket);
  await manager.shutdownWorkspace(root); await manager.shutdownWorkspace(null);
  installDeliveryPort({ sendToConnection: () => {}, sendToAskTargets: () => {}, broadcast: () => {},
    broadcastToSession: () => {}, sendToController: () => {} });
  resetTestDatabase(); Paths.reset(); await rm(root, { recursive: true, force: true });
});
const enable = () => manager.saveServer(null, BUILTIN_BROWSER_MCP_NAME, { type: 'builtin', id: 'browser', enabled: true });
async function request(index = 0): Promise<AskRequestMessage> {
  for (let attempt = 0; attempt < 100 && !requests[index]; attempt++) await Bun.sleep(2);
  expect(requests[index]).toBeDefined();
  return requests[index]!.message;
}
async function reply(message: AskRequestMessage, response: unknown): Promise<boolean> {
  return browserService.resolveAsk(message.toolCallId, response, message.requestId);
}
const imageReply = { type: 'client_capability', capability: 'browser_screenshot',
  result: { success: true, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' } };

test('built-in is opt-in, requires a session and supports per-tool restrictions', async () => {
  expect((await manager.getAllServerStatus(null))[BUILTIN_BROWSER_MCP_NAME]?.config?.enabled).toBe(false);
  expect(await manager.getWorkspaceTools(root, 'session')).toEqual([]);
  await enable();
  expect(await manager.getWorkspaceTools(root)).toEqual([]);
  expect(await manager.getWorkspaceTools(root, 'session')).toHaveLength(6);
  await manager.setToolEnabled(null, BUILTIN_BROWSER_MCP_NAME, 'browser_screenshot', false);
  expect(await manager.getWorkspaceTools(root, 'session')).toHaveLength(5);
  await expect(manager.saveServer(null, 'other', { type: 'builtin', id: 'browser' })).rejects.toThrow('reserved');
});

test('screenshots target one connection, require matching identity and return MCP images', async () => {
  await enable();
  const tool = (await manager.getWorkspaceTools(root, 'session')).find(tool => tool.name === 'browser_screenshot')!;
  const result = tool.execute({}, abort.signal);
  const message = await request();
  expect(requests[0]!.connection).toBe(extension);
  expect(getPermissionRequestByRequestId(message.requestId!)).toBeNull();
  expect(browserService.acceptsConnection(message.toolCallId, 'wrong')).toBe(false);
  expect(await browserService.resolveAsk(message.toolCallId, imageReply, 'stale')).toBe(false);
  expect(await reply(message, imageReply)).toBe(true);
  expect((await result).content[1]).toEqual({ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' });
  expect(await reply(message, imageReply)).toBe(false);
});

test('disabled handles and revoked permissions never dispatch browser actions', async () => {
  await enable();
  const tool = (await manager.getWorkspaceTools(root, 'session')).find(tool => tool.name === 'browser_navigate')!;
  const result = tool.execute({ url: 'https://example.com' }, abort.signal);
  const rejected = result.catch((error: unknown) => error);
  const permission = await request();
  expect(permission.ask.type).toBe('permission');
  expect(getPermissionRequestByRequestId(permission.requestId!)?.status).toBe('pending');
  await manager.setToolEnabled(null, BUILTIN_BROWSER_MCP_NAME, tool.name, false);
  expect(await reply(permission, { type: 'permission', grant: 'once' })).toBe(false);
  expect(await rejected).toMatchObject({ message: 'Browser access is no longer available' });
  expect(requests).toHaveLength(1);
  await expect(tool.execute({ url: 'https://example.com' }, abort.signal)).rejects.toThrow('no longer');
});

test('session changes during asynchronous authorization fail before dispatch', async () => {
  await enable();
  const tool = (await manager.getWorkspaceTools(root, 'session'))[0]!;
  await expect(tool.execute({}, abort.signal, async () => {
    updateSession('session', { status: 'closed' });
    return true;
  })).rejects.toThrow('no longer');
  expect(requests).toHaveLength(0);
});

test('permission mode changes while awaiting approval revoke the call', async () => {
  await enable();
  const tool = (await manager.getWorkspaceTools(root, 'session')).find(tool => tool.name === 'browser_navigate')!;
  const result = tool.execute({ url: 'https://example.com' }, abort.signal).catch((error: unknown) => error);
  const permission = await request();
  updateSession('session', { permissionMode: 'extended' });
  expect(await reply(permission, { type: 'permission', grant: 'session' })).toBe(false);
  expect(await result).toMatchObject({ message: 'Browser access is no longer available' });
  expect(requests).toHaveLength(1);
  expect(getPermissionRequestByRequestId(permission.requestId!)?.status).toBe('expired');
});

test('malformed grants deny without dispatch or remembered grants', async () => {
  await enable();
  const tool = (await manager.getWorkspaceTools(root, 'session')).find(tool => tool.name === 'browser_navigate')!;
  const result = tool.execute({ url: 'https://example.com' }, abort.signal);
  const permission = await request();
  await reply(permission, { type: 'permission', grant: 'workspace' });
  expect((await result).isError).toBe(true);
  expect(getPermissionRequestByRequestId(permission.requestId!)?.status).toBe('denied');
  expect(requests).toHaveLength(1);
});

test('abort clears waiters and stale replies cannot execute', async () => {
  await enable();
  const tool = (await manager.getWorkspaceTools(root, 'session'))[0]!;
  const result = tool.execute({}, abort.signal);
  const rejected = result.catch((error: unknown) => error);
  const pending = await request();
  abort.abort();
  expect(await rejected).toBeInstanceOf(Error);
  expect(await reply(pending, { type: 'client_capability', capability: 'active_tab_read', result: { text: 'late' } })).toBe(false);
});

test('ambiguous extension profiles fail before dispatch', async () => {
  await enable(); connect('second-profile', 'extension');
  const tool = (await manager.getWorkspaceTools(root, 'session'))[0]!;
  await expect(tool.execute({}, abort.signal)).rejects.toThrow('exactly one');
  expect(requests).toHaveLength(0);
});

test('invalid arguments fail before approval or dispatch', () => {
  expect(() => validateBrowserInput('browser_dom_action', { action: 'delete-everything' })).toThrow();
  expect(() => validateBrowserInput('browser_navigate', { url: 123 })).toThrow();
  expect(() => validateBrowserInput('browser_screenshot', { tabId: -1 })).toThrow();
  expect(() => validateBrowserInput('browser_tab_manage', { action: 'create', url: 'javascript:alert(1)' })).toThrow();
});

test('transport accepts only the controller permission reply and pinned extension result', async () => {
  await enable();
  const rejected: ServerMessage[] = [];
  const ctx = { send: (_id: ConnectionId, message: ServerMessage) => rejected.push(message) } as unknown as RouterContext<ConnectionId>;
  const stranger = connect('stranger', 'web');
  const controller = connect('controller', 'web');
  const tool = (await manager.getWorkspaceTools(root, 'session')).find(tool => tool.name === 'browser_navigate')!;
  const result = tool.execute({ url: 'https://example.com' }, abort.signal);
  const permission = await request();
  const approval = { type: 'ask.response' as const, toolCallId: permission.toolCallId, requestId: permission.requestId,
    response: { type: 'permission' as const, grant: 'once' as const } };
  await handleAskResponse(ctx, stranger, approval);
  expect(rejected[0]?.type).toBe('ask.response_rejected');
  expect(requests).toHaveLength(1);
  await handleAskResponse(ctx, controller, approval);
  const operation = await request(1);
  const response = { type: 'ask.response' as const, toolCallId: operation.toolCallId, requestId: operation.requestId,
    response: { type: 'client_capability' as const, capability: 'browser_navigate', result: { success: true } } };
  await handleAskResponse(ctx, controller, response);
  expect(await browserService.getSessionIdForPendingAsk(operation.toolCallId, operation.requestId)).toBe('session');
  await handleAskResponse(ctx, extension, response);
  expect((await result).isError).toBe(false);
});

test('session grants are reused only in their original session', async () => {
  await enable();
  const tools = await manager.getWorkspaceTools(root, 'session');
  const tool = tools.find(tool => tool.name === 'browser_navigate')!;
  const first = tool.execute({ url: 'https://example.com' }, abort.signal);
  await reply(await request(), { type: 'permission', grant: 'session' });
  await reply(await request(1), { type: 'client_capability', capability: 'browser_navigate', result: { success: true } });
  expect((await first).isError).toBe(false);
  const second = tool.execute({ url: 'https://example.com' }, abort.signal);
  expect((await request(2)).ask.type).toBe('client_capability');
  await reply(await request(2), { type: 'client_capability', capability: 'browser_navigate', result: { success: true } });
  await second;
  createSession({ id: 'other-session', workspaceId: 'ws', title: 'Other', status: 'active',
    permissionMode: 'standard', preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'codex-cli' });
  handleClaim('other-session', connect('other-controller', 'web'));
  const other = (await manager.getWorkspaceTools(root, 'other-session')).find(tool => tool.name === 'browser_navigate')!;
  const third = other.execute({ url: 'https://example.com' }, abort.signal);
  expect((await request(3)).ask.type).toBe('permission');
  await reply(await request(3), { type: 'permission', grant: 'deny' });
  expect((await third).isError).toBe(true);
});

test('workspace policy overrides global browser policy and revokes inherited handles', async () => {
  await enable();
  expect((await manager.getAllServerStatus(root))[BUILTIN_BROWSER_MCP_NAME]?.config?.enabled).toBe(true);
  const tool = (await manager.getWorkspaceTools(root, 'session'))[0]!;
  await manager.setToolEnabled(root, BUILTIN_BROWSER_MCP_NAME, tool.name, false);
  await expect(tool.execute({}, abort.signal)).rejects.toThrow('no longer');
  expect(await manager.getWorkspaceTools(root, 'session')).toHaveLength(5);
  await manager.disconnectServer(root, BUILTIN_BROWSER_MCP_NAME);
  expect(await manager.getWorkspaceTools(root, 'session')).toHaveLength(0);
});

test('disconnect and timeout settle without retrying dispatched commands', async () => {
  await manager.saveServer(null, BUILTIN_BROWSER_MCP_NAME, { type: 'builtin', id: 'browser', enabled: true, timeout: 100 });
  const tool = (await manager.getWorkspaceTools(root, 'session'))[0]!;
  const timedOut = tool.execute({}, abort.signal);
  await request();
  expect((await timedOut).isError).toBe(true);
  expect(requests).toHaveLength(1);
  const disconnected = tool.execute({}, abort.signal);
  const pending = await request(1);
  unregisterConnection(sockets[0]);
  expect((await disconnected).isError).toBe(true);
  expect(await reply(pending, { type: 'client_capability', capability: 'active_tab_read', result: { text: 'late' } })).toBe(false);
  expect(requests).toHaveLength(2);
});

test('Prokop, Claude and Codex preserve screenshot image blocks', async () => {
  await enable();
  onRequest = message => { void reply(message, imageReply); };
  const prokop = (await getTools(root, 'session')).browser_screenshot!;
  const output = await prokop.execute!({}, { toolCallId: 'p', messages: [], abortSignal: abort.signal });
  expect(output).toMatchObject({ type: 'capek-tool-output', modelOutput: [
    { type: 'text' }, { type: 'image', data: 'iVBORw0KGgo=', mediaType: 'image/png' },
  ] });
  expect(await prokop.toModelOutput!({ toolCallId: 'p', input: {}, output })).toMatchObject({ type: 'content',
    value: [{ type: 'text' }, { type: 'image-data', data: 'iVBORw0KGgo=' }] });
  const codex = createCodexMcpTools({ bridge: { tools: manager.getWorkspaceTools }, path: root,
    sessionId: 'session', signal: abort.signal, authorized: () => true });
  expect(await codex.call({ namespace: null, turnId: 'turn', callId: 'c', tool: 'mcp_call_tool',
    arguments: { tool: 'browser_screenshot', arguments: {} } })).toMatchObject({ success: true,
    contentItems: [{ type: 'inputText' }, { type: 'inputImage', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' }] });
  const claude = createClaudeWorkspaceMcp(await manager.getWorkspaceTools(root, 'session'), abort.signal, () => true)!;
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await claude.instance.connect(b); await client.connect(a);
  try {
    expect(await client.callTool({ name: 'browser_screenshot', arguments: {} })).toMatchObject({
      content: [{ type: 'text' }, { type: 'image', data: 'iVBORw0KGgo=' }] });
  } finally { await client.close(); await claude.instance.close(); }
});
