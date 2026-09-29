import { beforeEach, afterEach, afterAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { Options, SDKMessage, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

type ToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>;
import type { PermissionAsk } from '@prokopai/sdk';
import { installMemoryToolFallback } from '@capekai/core/hosts';
import { codexMemoryTools } from '@/adapters/capek/codex-memory';
import { claudeMemoryShape, claudeMcpToolDisplayName, createClaudeMemoryTools } from '@/harnesses/claude-cli/dynamic-tools';
import { createClaudeExecution } from '@/harnesses/claude-cli/execution';
import type { SessionWirePorts } from '@/application/ports/delivery';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession, getSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { updateWorkspace } from '@/infrastructure/sqlite/workspaces';
import { resolveWorkspaceMemoryDir } from '@/infrastructure/runtime/workspace-dirs';
import { saveClaudeModelSelection } from '@/harnesses/claude-cli/models';
import { Paths } from '@/infrastructure/runtime/paths';
import { mkdirSync } from 'node:fs';

const root = mkdtempSync(join(tmpdir(), 'claude-memory-'));
const agentDir = join(root, 'agent');
const fakeDefs = ['memory', 'agent_memory', 'shell'].map(name => ({
  type: 'function' as const, name, description: `description for ${name}`, inputSchema: { type: 'object' },
}));
const fakeBridge = { definitions: () => fakeDefs, execute: codexMemoryTools.execute };

beforeEach(() => {
  setupTestDatabase();
  seedWorkspace({ id: 'ws', path: root });
  createSession({ id: 's', workspaceId: 'ws', title: 'Claude', status: 'active',
    preconfigId: 'agent', metadata: null, parentId: null, agentName: null, harness: 'claude-cli' });
});
afterEach(() => resetTestDatabase());
afterAll(() => rmSync(root, { recursive: true, force: true }));

function tools(overrides: Partial<Parameters<typeof createClaudeMemoryTools>[0]> = {}) {
  return createClaudeMemoryTools({ bridge: fakeBridge, sessionId: 's', workspaceId: 'ws', root,
    agentDir, preconfigId: 'agent', signal: new AbortController().signal,
    ask: async () => false, ...overrides });
}

test('zod schema matches the live Capek memory definitions', () => {
  installMemoryToolFallback();
  const definitions = codexMemoryTools.definitions();
  expect(definitions.map(definition => definition.name).sort()).toEqual(['agent_memory', 'memory']);
  const schema = z.toJSONSchema(z.object(claudeMemoryShape));
  // zod v4 toJSONSchema adds standard-schema metadata, a $schema header, and
  // additionalProperties:false; compare the meaningful schema parts on both sides.
  const boilerplate = new Set(['~standard', '$schema', 'additionalProperties']);
  const clean = (value: unknown): unknown => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !boilerplate.has(key)).map(([key, item]) => [key, clean(item)]))
    : value;
  for (const definition of definitions) {
    expect(clean(definition.inputSchema)).toEqual(clean(schema));
  }
});

test('registration follows the workspace memory setting and the agent home', () => {
  expect(tools({ agentDir: null }).map(item => item.name)).toEqual([]);
  expect(tools().map(item => item.name)).toEqual(['agent_memory']);
  updateWorkspace('ws', { settings: { memory: { enabled: true, permissionRisk: 'low' } } });
  expect(tools().map(item => item.name)).toEqual(['memory', 'agent_memory']);
});

test('each tool routes to its own directory, risk, and ask path', async () => {
  updateWorkspace('ws', { settings: { memory: { enabled: true, permissionRisk: 'medium' } } });
  const seen: Array<{ directory: string; risk: string; asked: boolean }> = [];
  const bridge = { definitions: () => fakeDefs,
    execute: async (_input: Record<string, unknown>, directory: string, risk: string, ask?: unknown) => {
      seen.push({ directory, risk, asked: ask !== undefined });
      return { success: true, result: { action: 'list', entries: [] } };
    } };
  const registered = tools({ bridge });
  const list = async (name: 'memory' | 'agent_memory'): Promise<ToolResult> =>
    registered.find(item => item.name === name)!.handler({ action: 'list', target: 'user' } as never, {});
  expect(await list('memory')).toMatchObject({ isError: false,
    content: [{ type: 'text', text: JSON.stringify({ action: 'list', entries: [] }) }] });
  await list('agent_memory');
  expect(seen).toEqual([
    { directory: resolveWorkspaceMemoryDir(root), risk: 'medium', asked: true },
    { directory: agentDir, risk: 'none', asked: false },
  ]);
});

test('agent memory writes through the in-process tool without any ask', async () => {
  const registered = tools({ bridge: fakeBridge });
  const result = await registered.find(item => item.name === 'agent_memory')!
    .handler({ action: 'add', target: 'user', content: 'prefers concise output' } as never, {});
  expect(result.isError).toBeFalsy();
  expect(readFileSync(join(agentDir, 'USER.md'), 'utf8')).toContain('prefers concise output');
});

test('workspace memory writes ask once and refuse on denial or setting changes', async () => {
  updateWorkspace('ws', { settings: { memory: { enabled: true, permissionRisk: 'high' } } });
  const asks: PermissionAsk[] = [];
  let approve = true;
  const registered = tools({ ask: async request => { asks.push(request); return approve; } });
  const memory = registered.find(item => item.name === 'memory')!;
  const write = (): Promise<ToolResult> =>
    memory.handler({ action: 'add', target: 'memory', content: 'a fact' } as never, {});
  expect((await write()).isError).toBeFalsy();
  expect(asks).toHaveLength(1);
  expect(asks[0]).toMatchObject({ risk: 'high', action: 'write', paths: ['MEMORY.md'] });
  approve = false;
  expect((await write()).isError).toBe(true);
  expect((await write()).content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('USER_REJECTION') });
  updateWorkspace('ws', { settings: { memory: { enabled: false, permissionRisk: 'high' } } });
  asks.length = 0;
  const off = await memory.handler({ action: 'list', target: 'user' } as never, {});
  expect(off.isError).toBe(true);
  expect(off.content[0]).toMatchObject({ type: 'text', text: 'Workspace memory is disabled' });
  expect(asks).toHaveLength(0);
});

test('a stale turn or changed preconfig refuses before executing', async () => {
  updateWorkspace('ws', { settings: { memory: { enabled: true, permissionRisk: 'low' } } });
  const controller = new AbortController();
  const registered = tools({ signal: controller.signal });
  controller.abort();
  const aborted = await registered.find(item => item.name === 'agent_memory')!
    .handler({ action: 'list', target: 'user' } as never, {});
  expect(aborted.isError).toBe(true);
  const fresh = tools();
  updateSession('s', { preconfigId: 'other' });
  const changed = await fresh.find(item => item.name === 'agent_memory')!
    .handler({ action: 'list', target: 'user' } as never, {});
  expect(changed.isError).toBe(true);
});

test('Claude turns register memory tools and guidance when the workspace enables memory', async () => {
  const dataDir = mkdtempSync(join(process.cwd(), '.claude-memory-exec-'));
  mkdirSync(join(dataDir, 'tools'));
  Paths.configure({ dataDir });
  try {
    updateWorkspace('ws', { settings: { memory: { enabled: true, permissionRisk: 'low' } } });
    createSession({ id: 'turn', workspaceId: 'ws', title: 'Claude', status: 'active',
      preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'claude-cli' });
    saveClaudeModelSelection('turn', { model: 'claude-sonnet-5', effort: 'medium' });
    const events: unknown[] = [];
    const wire = { actor: { attachOriginToSession: () => {} }, delivery: {
      send: (_origin: string, value: unknown) => events.push(value),
      broadcastToSession: (_id: string, value: unknown) => events.push(value),
      broadcast: (value: unknown) => events.push(value),
    } } as unknown as SessionWirePorts<string>;
    let seen: Options | undefined;
    const exec = createClaudeExecution({ version: () => '2.1.274', memoryTools: fakeBridge,
      instructions: {
        listPreconfigs: async () => [{ id: 'agent', mode: 'primary', systemPrompt: 'Work carefully.' }] as never,
        getPreconfig: async id => ({ id, mode: 'primary', systemPrompt: 'Work carefully.' }) as never,
        getAgentDirectory: async () => agentDir,
        readAgentMemoryFile: async () => null,
      },
      start: (_prompt, options) => {
        seen = options;
        const sessionId = options.sessionId ?? crypto.randomUUID();
        async function* messages(): AsyncGenerator<SDKMessage> {
          yield { type: 'system', subtype: 'init', session_id: sessionId } as SDKMessage;
          yield { type: 'result', subtype: 'success', session_id: sessionId, result: 'reply' } as SDKMessage;
        }
        return messages();
      } });
    await exec.sendMessage(wire, 'origin', 'turn', 'hello');
    expect(Object.keys(seen?.mcpServers ?? {})).toEqual(['prokop']);
    const append = (seen?.systemPrompt as { append?: string } | undefined)?.append ?? '';
    expect(append).toContain('You can persist durable workspace knowledge using the memory tool.');
    expect(append).toContain('Use "agent_memory" (personal) for cross-project knowledge');
    expect(getSession('turn')?.preconfigId).toBe('agent');
  } finally {
    Paths.reset();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('MCP tool names map to friendly transcript labels', () => {
  expect(claudeMcpToolDisplayName('mcp__prokop__memory')).toBe('Claude Memory');
  expect(claudeMcpToolDisplayName('mcp__prokop__agent_memory')).toBe('Claude Agent memory');
  expect(claudeMcpToolDisplayName('Read')).toBeNull();
});
