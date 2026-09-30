import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryDomainTools } from '@/adapters/capek/domain-tools';
import { createCodexMemoryTools } from '@/harnesses/codex-cli/memory-tools';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { updateWorkspace } from '@/infrastructure/sqlite/workspaces';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';

const root = mkdtempSync(join(tmpdir(), 'codex-memory-'));
const agentDir = join(root, 'agent');
const defs = ['memory', 'agent_memory', 'shell'].map(name => ({
  type: 'function' as const, name, description: name, inputSchema: { type: 'object' },
}));
const bridge = { definitions: () => defs, execute: memoryDomainTools.execute };

beforeEach(() => {
  setupTestDatabase(); seedWorkspace({ id: 'ws', path: root });
  createSession({ id: 's', workspaceId: 'ws', title: 'Test', status: 'active',
    preconfigId: 'agent', metadata: null, parentId: null, agentName: null, harness: 'codex-cli' });
});
afterEach(() => resetTestDatabase());
afterAll(() => rmSync(root, { recursive: true, force: true }));

function call(tool: string, callId: string, args: unknown, turnId = 'turn'): unknown {
  return { threadId: 'thread', turnId, callId, namespace: null, tool, arguments: args };
}

test('memory allowlist is scoped to enabled workspace memory and the selected agent directory', async () => {
  let active = true;
  let validRoot = true;
  const tools = createCodexMemoryTools({ bridge, sessionId: 's', workspaceId: 'ws', root,
    agentDir, isActive: turn => active && turn === 'turn', authorizeRoot: () => validRoot });
  expect(tools.definitions.map(def => def.name)).toEqual(['agent_memory']);
  expect((await tools.call(call('memory', 'disabled', { action: 'list', target: 'user' }))).success).toBe(false);
  expect((await tools.call(call('shell', 'shell', {}))).success).toBe(false);
  const added = await tools.call(call('agent_memory', 'add', { action: 'add', target: 'user', content: 'a preference' }));
  expect(added.success).toBe(true);
  expect(readFileSync(join(agentDir, 'USER.md'), 'utf8')).toContain('a preference');
  expect((await tools.call(call('agent_memory', 'add', { action: 'add', target: 'user', content: 'again' }))).success).toBe(false);
  active = false;
  expect((await tools.call(call('agent_memory', 'stale', { action: 'add', target: 'user', content: 'again' }))).success).toBe(false);
  active = true;
  validRoot = false;
  expect((await tools.call(call('agent_memory', 'wrong-root', { action: 'list', target: 'user' }))).success).toBe(false);
  expect(readFileSync(join(agentDir, 'USER.md'), 'utf8')).not.toContain('again');
});

test('workspace memory always writes without an ask when enabled', async () => {
  updateWorkspace('ws', { settings: { memory: { enabled: true, permissionRisk: 'high' } } });
  const tools = createCodexMemoryTools({ bridge, sessionId: 's', workspaceId: 'ws', root,
    agentDir: null, isActive: () => true, authorizeRoot: () => true });
  expect(tools.definitions.map(def => def.name)).toEqual(['memory']);
  const input = { action: 'add', target: 'memory', content: 'workspace fact' };
  expect((await tools.call(call('memory', 'allowed', input))).success).toBe(true);
  expect(readFileSync(join(root, '.prokopai', 'MEMORY.md'), 'utf8')).toContain('workspace fact');
  updateWorkspace('ws', { settings: { memory: { enabled: false, permissionRisk: 'high' } } });
  expect((await tools.call(call('memory', 'disabled', { action: 'list', target: 'memory' }))).success).toBe(false);
});

afterEach(() => rmSync(join(root, 'agent'), { recursive: true, force: true }));
afterEach(() => rmSync(join(root, '.prokopai'), { recursive: true, force: true }));
