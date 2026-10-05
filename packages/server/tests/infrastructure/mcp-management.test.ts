import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadMcpConfig, updateMcpConfig } from '@/infrastructure/mcp/config';
import { getAllServerStatus, getWorkspaceTools, getServerTools, saveServer, setToolEnabled,
  removeServer, shutdownWorkspace, initializeWorkspace } from '@/infrastructure/mcp/manager';
import { getTools } from '@/infrastructure/mcp/converter';
import { Paths } from '@/infrastructure/runtime/paths';
import { createProkopMcpDiscovery } from '@/adapters/capek/mcp-discovery';
import type { Preconfig } from '@capekai/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createClaudeWorkspaceMcp } from '@/harnesses/claude-cli/mcp-tools';
import { createCodexMcpTools } from '@/harnesses/codex-cli/mcp-tools';
import type { McpServerConfig } from '@prokopai/sdk';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mcp-management-')); Paths.configure({ dataDir: join(root, 'global') }); });
afterEach(async () => { await shutdownWorkspace(root); await shutdownWorkspace(null); Paths.reset(); await rm(root, { recursive: true, force: true }); });
const config: McpServerConfig = { type: 'local', command: [process.execPath, resolve(import.meta.dir, 'fixtures/mcp-server.ts')], timeout: 2000 };

describe('workspace MCP management', () => {
  test('global tools are callable through Codex and Claude and are revoked in both', async () => {
    await saveServer(null, 'search', config);
    const tools = await getWorkspaceTools(root);
    const tool = tools[0]!;
    const codex = createCodexMcpTools({ bridge: { tools: getWorkspaceTools }, path: root, authorized: () => true });
    const request = (callId: string) => ({ namespace: null, turnId: 'turn', callId, tool: 'mcp_call_tool', arguments: { tool: tool.name, arguments: {} } });
    expect((await codex.call(request('first'))).success).toBe(true);
    const claude = createClaudeWorkspaceMcp(tools, new AbortController().signal, () => true)!;
    const client = new Client({ name: 'test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await claude.instance.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools).toHaveLength(2);
      expect((await client.callTool({ name: tool.name, arguments: {} })).isError).not.toBe(true);
      await setToolEnabled(null, 'search', tool.toolName, false);
      expect((await codex.call(request('second'))).success).toBe(false);
      expect((await client.callTool({ name: tool.name, arguments: {} })).isError).toBe(true);
    } finally { await client.close(); await claude.instance.close(); }
  });

  test('global tools are inherited, workspace names override them, and old handles honor changes', async () => {
    await saveServer(null, 'crm', config);
    expect((await loadMcpConfig(null)).servers.crm).toEqual(config);
    expect(await loadMcpConfig(root)).toEqual({ servers: {} });
    expect(await readFile(join(root, 'global/mcp.json'), 'utf8')).toContain('crm');
    const tools = await getWorkspaceTools(root);
    expect(tools).toHaveLength(2);
    expect((await tools[0]!.execute({})).content).toHaveLength(1);
    await saveServer(root, 'crm', { ...config, enabled: false });
    expect(await getWorkspaceTools(root)).toEqual([]);
    await expect(tools[0]!.execute({})).rejects.toThrow('overridden');
    await saveServer(root, 'crm', config);
    const localTools = await getWorkspaceTools(root);
    expect(localTools).toHaveLength(2);
    expect(localTools[0]!.name).not.toBe(tools[0]!.name);
    await removeServer(root, 'crm');
    expect((await getWorkspaceTools(root)).map(tool => tool.name)).toEqual(tools.map(tool => tool.name));
    await setToolEnabled(null, 'crm', tools[0]!.toolName, false);
    await expect(tools[0]!.execute({})).rejects.toThrow('disabled');
    expect(await getWorkspaceTools(root)).toHaveLength(1);
    await shutdownWorkspace(null);
    expect(await getWorkspaceTools(root)).toHaveLength(1);
    await removeServer(null, 'crm');
    expect(await getWorkspaceTools(root)).toEqual([]);
  });

  test('global and workspace servers with different names both remain available', async () => {
    await saveServer(null, 'search', config);
    await saveServer(root, 'crm', config);
    const tools = await getWorkspaceTools(root);
    expect(tools).toHaveLength(4);
    expect(new Set(tools.map(tool => tool.name)).size).toBe(4);
    await saveServer(null, 'search', { ...config, enabled: false });
    expect((await getWorkspaceTools(root)).map(tool => tool.serverName)).toEqual(['crm', 'crm']);
  });

  test.each([undefined, 'primary', 'both', 'subagent'] as const)('Prokop mode %s gates global and workspace MCP at discovery and execution', async initialMode => {
    await saveServer(null, 'search', config);
    await saveServer(root, 'crm', config);
    let mode = initialMode;
    let exists = true;
    const discovery = createProkopMcpDiscovery({
      session: () => exists ? { workspaceId: 'ws', preconfigId: 'agent' } : null,
      workspacePath: () => root,
      preconfig: async () => ({ id: 'agent', mode }) as Preconfig,
      tools: getTools,
    });
    expect(await discovery.discoverTools!('/unused')).toEqual({});
    const tools = await discovery.discoverTools!('/unused', 'session');
    if (mode === 'subagent') {
      expect(tools).toEqual({});
      return;
    }
    expect(Object.keys(tools)).toHaveLength(4);
    const execute = Object.values(tools)[0]!.execute as (input: unknown) => Promise<unknown>;
    await expect(execute({})).resolves.toBeDefined();
    mode = 'subagent';
    await expect(execute({})).rejects.toThrow('not allowed');
    expect(await discovery.discoverTools!('/unused', 'session')).toEqual({});
    mode = 'both';
    await expect(execute({})).resolves.toBeDefined();
    exists = false;
    await expect(execute({})).rejects.toThrow('not allowed');
  });

  test('serializes concurrent configuration writes and retains disabled servers', async () => {
    await Promise.all(['one', 'two', 'three'].map(name => updateMcpConfig(root, name, { ...config, enabled: false })));
    expect(Object.keys((await loadMcpConfig(root)).servers).sort()).toEqual(['one', 'three', 'two']);
    expect(Object.keys(await getAllServerStatus(root))).toHaveLength(4); // Includes the built-in browser entry.
    await initializeWorkspace(root);
    expect(await getWorkspaceTools(root)).toEqual([]);
  });
  test('reads and edits the legacy location without creating a second configuration', async () => {
    await mkdir(join(root, '.jean2'));
    await writeFile(join(root, '.jean2/mcp.json'), JSON.stringify({ servers: { existing: config } }));
    await updateMcpConfig(root, 'next', { ...config, enabled: false });
    expect(Object.keys(JSON.parse(await readFile(join(root, '.jean2/mcp.json'), 'utf8')).servers)).toEqual(['existing', 'next']);
    await expect(readFile(join(root, '.prokopai/mcp.json'))).rejects.toThrow();
  });
  test('rejects malformed policy and refuses to overwrite a broken configuration', async () => {
    await mkdir(join(root, '.prokopai'));
    await writeFile(join(root, '.prokopai/mcp.json'), '{broken');
    await expect(updateMcpConfig(root, 'new', config)).rejects.toThrow('Invalid mcp.json');
    expect(await readFile(join(root, '.prokopai/mcp.json'), 'utf8')).toBe('{broken');
    await expect(updateMcpConfig(root, '__proto__', config)).rejects.toThrow();
    await expect(updateMcpConfig(root, 'x', { ...config, enabled: 'false' } as unknown as McpServerConfig)).rejects.toThrow();
  });
  test('connects a real stdio server, revokes already-discovered tools, and preserves policy after restart', async () => {
    await saveServer(root, 'crm', config);
    expect((await getAllServerStatus(root)).crm?.status.status).toBe('connected');
    const tools = await getWorkspaceTools(root);
    expect(tools).toHaveLength(2);
    const write = tools.find(tool => tool.toolName === 'write_records')!;
    expect((await write.execute({ value: 1 })).content[0]?.text).toContain('write_records');
    const prokop = await getTools(root, 's1');
    await setToolEnabled(root, 'crm', 'write_records', false);
    expect((await getWorkspaceTools(root)).map(tool => tool.toolName)).toEqual(['read_records']);
    await expect(write.execute({})).rejects.toThrow('disabled');
    await expect((prokop[write.name]!.execute as (input: unknown) => Promise<unknown>)({})).rejects.toThrow('disabled');
    expect(await getServerTools(root, 'crm')).toContainEqual({ name: 'write_records', description: 'Write records', enabled: false });
    await shutdownWorkspace(root);
    expect((await getWorkspaceTools(root)).map(tool => tool.toolName)).toEqual(['read_records']);
    await saveServer(root, 'crm', { ...config, enabled: false });
    expect(await getWorkspaceTools(root)).toEqual([]);
    expect((await getAllServerStatus(root)).crm?.status.status).toBe('disabled');
    await removeServer(root, 'crm');
    expect(await getAllServerStatus(root)).toEqual({ 'Prokop Browser': {
      config: { type: 'builtin', id: 'browser', enabled: false }, status: { status: 'disabled' },
    } });
  });
  test('config replacement invalidates old handles and isolates workspace credentials and tools', async () => {
    await saveServer(root, 'crm', config);
    const tools = await getWorkspaceTools(root);
    await saveServer(root, 'crm', { ...config, env: { CHANGED: 'yes' } });
    await expect(tools[0]!.execute({})).rejects.toThrow('changed');
    const other = await mkdtemp(join(tmpdir(), 'mcp-other-'));
    try { expect(await getWorkspaceTools(other)).toEqual([]); }
    finally { await shutdownWorkspace(other); await rm(other, { recursive: true, force: true }); }
  });
});
