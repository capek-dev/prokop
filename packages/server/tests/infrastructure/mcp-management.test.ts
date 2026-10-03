import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadMcpConfig, updateMcpConfig } from '@/infrastructure/mcp/config';
import { getAllServerStatus, getWorkspaceTools, getServerTools, saveServer, setToolEnabled,
  removeServer, shutdownWorkspace, initializeWorkspace } from '@/infrastructure/mcp/manager';
import { getTools } from '@/infrastructure/mcp/converter';
import type { McpServerConfig } from '@prokopai/sdk';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mcp-management-')); });
afterEach(async () => { await shutdownWorkspace(root); await rm(root, { recursive: true, force: true }); });
const config: McpServerConfig = { type: 'local', command: [process.execPath, resolve(import.meta.dir, 'fixtures/mcp-server.ts')], timeout: 2000 };

describe('workspace MCP management', () => {
  test('serializes concurrent configuration writes and retains disabled servers', async () => {
    await Promise.all(['one', 'two', 'three'].map(name => updateMcpConfig(root, name, { ...config, enabled: false })));
    expect(Object.keys((await loadMcpConfig(root)).servers).sort()).toEqual(['one', 'three', 'two']);
    expect(Object.keys(await getAllServerStatus(root))).toHaveLength(3);
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
    expect(await getAllServerStatus(root)).toEqual({});
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
