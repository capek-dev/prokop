import { beforeEach, afterEach, afterAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { Options, SDKMessage, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

type ToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>;
import type { PermissionAsk } from '@prokopai/sdk';
import { installMemoryToolFallback, installSessionSearchToolFallback, installSkillsToolFallback } from '@capekai/core/hosts';
import { agentSkillsDomainTools, memoryDomainTools, sessionSearchDomainTools } from '@/adapters/capek/domain-tools';
import { claudeMemoryShape, claudeSessionSearchShape, claudeSkillManageShape,
  createClaudeMemoryTools, createClaudeSessionSearchTools, createClaudeSkillManageTools } from '@/harnesses/claude-cli/dynamic-tools';
import { claudeToolName, claudeToolVisualization } from '@/harnesses/shared/tool-viz';
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
const fakeBridge = { definitions: () => fakeDefs, execute: memoryDomainTools.execute };
const fakeSearchDefs = [{ type: 'function' as const, name: 'session_search',
  description: 'Search prior conversation messages', inputSchema: { type: 'object' } }];
const fakeSearchBridge = { definitions: () => fakeSearchDefs,
  execute: sessionSearchDomainTools.execute };
const fakeSkillDefs = [{ type: 'function' as const, name: 'agent_skill_manage',
  description: 'Manage agent skills', inputSchema: { type: 'object' } }];
const fakeSkillBridge = { definitions: () => fakeSkillDefs, execute: agentSkillsDomainTools.execute };

// zod v4 toJSONSchema adds standard-schema metadata, a $schema header, and
// additionalProperties:false; compare the meaningful schema parts on both sides.
const boilerplate = new Set(['~standard', '$schema', 'additionalProperties']);
const clean = (value: unknown): unknown => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !boilerplate.has(key)).map(([key, item]) => [key, clean(item)]))
  : value;

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
    ...overrides });
}

function searchTools(overrides: Partial<Parameters<typeof createClaudeSessionSearchTools>[0]> = {}) {
  return createClaudeSessionSearchTools({ bridge: fakeSearchBridge, sessionId: 's', workspaceId: 'ws',
    agentDir, preconfigId: 'agent', signal: new AbortController().signal,
    ...overrides });
}

function skillTools(overrides: Partial<Parameters<typeof createClaudeSkillManageTools>[0]> = {}) {
  return createClaudeSkillManageTools({ bridge: fakeSkillBridge, sessionId: 's', workspaceId: 'ws',
    preconfigId: 'agent', agentDir, signal: new AbortController().signal, ...overrides });
}

test('zod schema matches the live Capek memory definitions', () => {
  installMemoryToolFallback();
  const definitions = memoryDomainTools.definitions();
  expect(definitions.map(definition => definition.name).sort()).toEqual(['agent_memory', 'memory']);
  const schema = z.toJSONSchema(z.object(claudeMemoryShape));
  for (const definition of definitions) {
    expect(clean(definition.inputSchema)).toEqual(clean(schema));
  }
});

test('zod schema matches the live Capek session search definition', () => {
  installSessionSearchToolFallback();
  const definitions = sessionSearchDomainTools.definitions();
  expect(definitions.map(definition => definition.name)).toEqual(['session_search']);
  const schema = z.toJSONSchema(z.object(claudeSessionSearchShape));
  for (const definition of definitions) {
    expect(clean(definition.inputSchema)).toEqual(clean(schema));
  }
});

test('zod schema matches the live Capek agent skill definition', () => {
  installSkillsToolFallback();
  const definitions = agentSkillsDomainTools.definitions();
  expect(definitions.map(definition => definition.name)).toEqual(['agent_skill_manage']);
  const schema = z.toJSONSchema(z.object(claudeSkillManageShape));
  for (const definition of definitions) {
    expect(clean(definition.inputSchema)).toEqual(clean(schema));
  }
});

test('agent skill manage registers only with a selected agent home', () => {
  expect(skillTools({ agentDir: null })).toEqual([]);
  expect(skillTools().map(item => item.name)).toEqual(['agent_skill_manage']);
});

test('agent skill writes stay in the selected agent home without any ask', async () => {
  mkdirSync(join(agentDir, 'skills'), { recursive: true });
  updateSession('s', { agentId: 'agent' });
  const seen: string[] = [];
  const bridge = { definitions: () => fakeSkillDefs,
    execute: async (input: Record<string, unknown>, directory: string) => {
      seen.push(directory);
      return agentSkillsDomainTools.execute(input, directory);
    } };
  const registered = skillTools({ bridge });
  const result = await registered.find(item => item.name === 'agent_skill_manage')!.handler(
    { action: 'create', name: 'Deploy Helper', description: 'Ship the app', content: 'Steps.' } as never, {});
  expect(result.isError).toBeFalsy();
  expect(seen).toEqual([join(agentDir, 'skills')]);
  // The result carries an absolute path so the model never guesses the location.
  expect(result.content[0]).toMatchObject({ type: 'text',
    text: expect.stringContaining(join(agentDir, 'skills', 'deploy-helper', 'SKILL.md')) });
  expect(readFileSync(join(agentDir, 'skills', 'deploy-helper', 'SKILL.md'), 'utf8'))
    .toContain('Ship the app');
});

test('a stale turn, unbound agent, or changed preconfig refuses skill calls', async () => {
  mkdirSync(join(agentDir, 'skills'), { recursive: true });
  const controller = new AbortController();
  const registered = skillTools({ signal: controller.signal });
  const handler = registered.find(item => item.name === 'agent_skill_manage')!.handler;
  controller.abort();
  expect((await handler({ action: 'list' } as never, {})).isError).toBe(true);
  const fresh = skillTools();
  const call = fresh.find(item => item.name === 'agent_skill_manage')!.handler;
  // The session has not bound its agent identity to the preconfig yet.
  expect((await call({ action: 'list' } as never, {})).isError).toBe(true);
  updateSession('s', { agentId: 'agent' });
  expect((await call({ action: 'list' } as never, {})).isError).toBeFalsy();
  updateSession('s', { preconfigId: 'other' });
  expect((await call({ action: 'list' } as never, {})).isError).toBe(true);
});

test('session search registers unconditionally: the read policy keeps it always on', () => {
  expect(searchTools().map(item => item.name)).toEqual(['session_search']);
  updateWorkspace('ws', { settings: { sessionSearch: {
    enabled: false, permissionRisk: 'low', includeToolResults: false } } });
  expect(searchTools().map(item => item.name)).toEqual(['session_search']);
});

test('session search routes settings and agent scope without any ask', async () => {
  updateWorkspace('ws', { settings: { sessionSearch: {
    enabled: true, permissionRisk: 'medium', includeToolResults: false } } });
  updateSession('s', { agentId: 'agent' });
  const seen: Array<{ input: unknown; includeToolResults: boolean; risk: string;
    agentId: string | null }> = [];
  const bridge = { definitions: () => fakeSearchDefs,
    execute: async (input: Record<string, unknown>, _ws: string, _session: string,
      includeToolResults: boolean, risk: string, _ask?: (request: PermissionAsk) => Promise<boolean>,
      agentId?: string | null) => {
      seen.push({ input, includeToolResults, risk, agentId: agentId ?? null });
      return { success: true, mode: 'search', title: 'ok', results: [] };
    } };
  const registered = searchTools({ bridge });
  const handler = registered.find(item => item.name === 'session_search')!.handler;
  const result = await handler({ query: 'deploy steps', scope: 'workspace' } as never, {});
  expect(result.isError).toBeFalsy();
  expect(seen[0]).toMatchObject({ includeToolResults: false, risk: 'none', agentId: 'agent' });
  // Agent scope without an agent home refuses before reaching the bridge.
  const noAgent = searchTools({ bridge, agentDir: null });
  const refused = await noAgent.find(item => item.name === 'session_search')!
    .handler({ action: 'list', scope: 'agent' } as never, {});
  expect(refused.isError).toBe(true);
  expect(refused.content[0]).toMatchObject({ type: 'text', text: 'Agent scope requires an agent session' });
  expect(seen).toHaveLength(1);
  // A stored disable is ignored at read time: search keeps running.
  updateWorkspace('ws', { settings: { sessionSearch: {
    enabled: false, permissionRisk: 'medium', includeToolResults: false } } });
  const off = await handler({ action: 'list' } as never, {});
  expect(off.isError).toBeFalsy();
});

test('registration follows the workspace memory setting and the agent home', () => {
  expect(tools({ agentDir: null }).map(item => item.name)).toEqual([]);
  expect(tools().map(item => item.name)).toEqual(['agent_memory']);
  updateWorkspace('ws', { settings: { memory: { enabled: true, permissionRisk: 'low' } } });
  expect(tools().map(item => item.name)).toEqual(['memory', 'agent_memory']);
});

test('each tool routes to its own directory and never asks', async () => {
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
    { directory: resolveWorkspaceMemoryDir(root), risk: 'none', asked: false },
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

test('workspace memory writes without any ask and still refuses when disabled', async () => {
  updateWorkspace('ws', { settings: { memory: { enabled: true, permissionRisk: 'high' } } });
  const registered = tools({});
  const memory = registered.find(item => item.name === 'memory')!;
  const write = (): Promise<ToolResult> =>
    memory.handler({ action: 'add', target: 'memory', content: 'a fact' } as never, {});
  expect((await write()).isError).toBeFalsy();
  expect(readFileSync(join(root, '.prokopai', 'MEMORY.md'), 'utf8')).toContain('a fact');
  updateWorkspace('ws', { settings: { memory: { enabled: false, permissionRisk: 'high' } } });
  const off = await memory.handler({ action: 'list', target: 'user' } as never, {});
  expect(off.isError).toBe(true);
  expect(off.content[0]).toMatchObject({ type: 'text', text: 'Workspace memory is disabled' });
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

test('Claude turns register session search and its guidance when the workspace enables it', async () => {
  const dataDir = mkdtempSync(join(process.cwd(), '.claude-search-exec-'));
  mkdirSync(join(dataDir, 'tools'));
  Paths.configure({ dataDir });
  try {
    updateWorkspace('ws', { settings: { sessionSearch: {
      enabled: true, permissionRisk: 'low', includeToolResults: false } } });
    createSession({ id: 'turn2', workspaceId: 'ws', title: 'Claude', status: 'active',
      preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'claude-cli' });
    saveClaudeModelSelection('turn2', { model: 'claude-sonnet-5', effort: 'medium' });
    const events: unknown[] = [];
    const wire = { actor: { attachOriginToSession: () => {} }, delivery: {
      send: (_origin: string, value: unknown) => events.push(value),
      broadcastToSession: (_id: string, value: unknown) => events.push(value),
      broadcast: (value: unknown) => events.push(value),
    } } as unknown as SessionWirePorts<string>;
    let seen: Options | undefined;
    const exec = createClaudeExecution({ version: () => '2.1.274', sessionSearch: fakeSearchBridge,
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
    await exec.sendMessage(wire, 'origin', 'turn2', 'hello');
    expect(Object.keys(seen?.mcpServers ?? {})).toEqual(['prokop']);
    const append = (seen?.systemPrompt as { append?: string } | undefined)?.append ?? '';
    expect(append).toContain('Use session_search to recall past conversations');
    expect(append).toContain('Prefer current_session for this conversation');
    // Memory stays unregistered and unadvertised in this workspace.
    expect(append).not.toContain('You can persist durable workspace knowledge using the memory tool.');
  } finally {
    Paths.reset();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Claude turns register the agent skill manager and its guidance for agent sessions', async () => {
  const dataDir = mkdtempSync(join(process.cwd(), '.claude-skills-exec-'));
  mkdirSync(join(dataDir, 'tools'));
  Paths.configure({ dataDir });
  try {
    createSession({ id: 'turn3', workspaceId: 'ws', title: 'Claude', status: 'active',
      preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'claude-cli' });
    saveClaudeModelSelection('turn3', { model: 'claude-sonnet-5', effort: 'medium' });
    const events: unknown[] = [];
    const wire = { actor: { attachOriginToSession: () => {} }, delivery: {
      send: (_origin: string, value: unknown) => events.push(value),
      broadcastToSession: (_id: string, value: unknown) => events.push(value),
      broadcast: (value: unknown) => events.push(value),
    } } as unknown as SessionWirePorts<string>;
    let seen: Options | undefined;
    const exec = createClaudeExecution({ version: () => '2.1.274', agentSkills: fakeSkillBridge,
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
    await exec.sendMessage(wire, 'origin', 'turn3', 'hello');
    expect(Object.keys(seen?.mcpServers ?? {})).toEqual(['prokop']);
    const append = (seen?.systemPrompt as { append?: string } | undefined)?.append ?? '';
    expect(append).toContain('Use agent_skill_manage to list or maintain skills in the selected agent home.');
    expect(getSession('turn3')?.agentId).toBe('agent');
  } finally {
    Paths.reset();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Claude tool names map to the canonical hybrid scheme', () => {
  // Prokop-builtin equivalents collapse to the shared vocabulary.
  expect(claudeToolName('Bash')).toBe('shell');
  expect(claudeToolName('Edit')).toBe('edit');
  expect(claudeToolName('MultiEdit')).toBe('edit');
  expect(claudeToolName('Write')).toBe('write-file');
  expect(claudeToolName('Read')).toBe('read-file');
  expect(claudeToolName('TodoWrite')).toBe('todo');
  expect(claudeToolName('Agent')).toBe('subagent');
  // Prokop MCP tools use their bare domain names (parent and child alike).
  expect(claudeToolName('mcp__prokop__memory')).toBe('memory');
  expect(claudeToolName('mcp__prokop__agent_memory')).toBe('agent_memory');
  expect(claudeToolName('mcp__prokop__session_search')).toBe('session_search');
  expect(claudeToolName('mcp__prokop__agent_skill_manage')).toBe('agent_skill_manage');
  // Foreign MCP reads server: tool; unknown tools stay native and unprefixed.
  expect(claudeToolName('mcp__filesystem__read_file')).toBe('filesystem: read_file');
  expect(claudeToolName('NotebookEdit')).toBe('edit');
  expect(claudeToolName('Unknown')).toBe('Unknown');
});

test('Claude completions synthesize real visualizations per canonical name', () => {
  const bash = claudeToolVisualization('shell', { command: 'npm test' }, 'all passing', false);
  expect(bash).toEqual({ type: 'shell-output', command: 'npm test', stdout: 'all passing', exitCode: 0 });

  const edit = claudeToolVisualization('edit',
    { file_path: 'src/a.ts', old_string: 'one', new_string: 'two\nlines' }, 'done', false);
  expect(edit).toMatchObject({ type: 'diff', path: 'src/a.ts', additions: 2, deletions: 1 });

  const grep = claudeToolVisualization('grep', { pattern: 'TODO' }, 'src/a.ts:1:TODO fix\nsrc/b.ts:3:TODO x', false);
  expect(grep).toMatchObject({ type: 'file-list', badge: '2 matches', total: 2 });

  const memory = claudeToolVisualization('memory', { action: 'list', target: 'memory' },
    JSON.stringify({ success: true, action: 'list', target: 'memory', entries: [], usage: { chars: 0, limit: 2500 } }), false);
  expect(memory).toEqual({ type: 'none', badge: '0 entries · 0/2500 chars', message: 'Memory (memory)' });

  expect(claudeToolVisualization('subagent', { prompt: 'go' }, 'summary', false))
    .toEqual({ type: 'none', message: 'Subagent task completed' });
  expect(claudeToolVisualization('NotebookEdit', {}, 'ok', false))
    .toEqual({ type: 'none', message: 'NotebookEdit completed' });
});
