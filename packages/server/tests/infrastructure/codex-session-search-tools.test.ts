import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { PermissionAsk, PermissionRiskLevel } from '@prokopai/sdk';
import { sessionSearchDomainTools } from '@/adapters/capek/domain-tools';
import { createCodexSessionSearchTools } from '@/harnesses/codex-cli/session-search-tools';
import { createSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { updateWorkspace } from '@/infrastructure/sqlite/workspaces';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';

const defs = ['session_search', 'shell'].map(name => ({
  type: 'function' as const, name, description: name, inputSchema: { type: 'object' },
}));
const settings = { enabled: true, permissionRisk: 'high' as const, includeToolResults: true };
const call = (callId: string, args: unknown, tool = 'session_search', turnId = 'turn'): unknown => ({
  threadId: 'thread', turnId, callId, namespace: null, tool, arguments: args,
});

beforeEach(() => {
  setupTestDatabase();
  seedWorkspace({ id: 'ws', path: process.cwd() });
  createSession({ id: 's', workspaceId: 'ws', title: 'Test', status: 'active',
    preconfigId: 'agent', metadata: null, parentId: null, agentName: null, harness: 'codex-cli' });
});
afterEach(() => resetTestDatabase());

test('session search uses the Prokop definition and stays hidden when disabled', async () => {
  expect(sessionSearchDomainTools.definitions().map(def => def.name)).toEqual(['session_search']);
  const tools = createCodexSessionSearchTools({ bridge: sessionSearchDomainTools, sessionId: 's', workspaceId: 'ws',
    preconfigId: 'agent', agentDir: null, isActive: () => true, authorizeRoot: () => true });
  expect(tools.definitions).toEqual([]);
  expect((await tools.call(call('disabled', { action: 'list' }))).success).toBe(false);
});

test('execution always runs without an ask and passes captured settings', async () => {
  updateWorkspace('ws', { settings: { sessionSearch: settings } });
  let active = true;
  let root = true;
  const contexts: Array<{ workspaceId: string; sessionId: string; risk: PermissionRiskLevel;
    agentId: string | null; includeTools: boolean }> = [];
  const bridge = { definitions: () => defs,
    execute: async (input: Record<string, unknown>, workspaceId: string, sessionId: string,
      includeTools: boolean, risk: PermissionRiskLevel, _ask: (request: PermissionAsk) => Promise<boolean>,
      agentId: string | null) => {
      contexts.push({ workspaceId, sessionId, risk, agentId, includeTools });
      return { success: true, mode: input.action ?? 'search', results: [{ sessionId: 's' }] };
    } };
  const tools = createCodexSessionSearchTools({ bridge, sessionId: 's', workspaceId: 'ws',
    preconfigId: 'agent', agentDir: null, isActive: id => active && id === 'turn',
    authorizeRoot: () => root });
  expect(tools.definitions.map(def => def.name)).toEqual(['session_search']);
  expect((await tools.call(call('list', { action: 'list' }))).success).toBe(true);
  expect((await tools.call(call('search', { query: 'hello' }))).success).toBe(true);
  expect(contexts).toEqual([
    { workspaceId: 'ws', sessionId: 's', risk: 'none', agentId: null, includeTools: true },
    { workspaceId: 'ws', sessionId: 's', risk: 'none', agentId: null, includeTools: true },
  ]);
  expect((await tools.call(call('bad', { scope: 'other', query: 'hello' }))).success).toBe(false);
  expect((await tools.call(call('shell', { action: 'list' }, 'shell'))).success).toBe(false);
  active = false;
  expect((await tools.call(call('inactive', { action: 'list' }))).success).toBe(false);
  active = true;
  root = false;
  expect((await tools.call(call('root', { action: 'list' }))).success).toBe(false);
  root = true;
  updateWorkspace('ws', { settings: { sessionSearch: { ...settings, enabled: false } } });
  expect((await tools.call(call('disabled', { action: 'list' }))).success).toBe(false);
});

test('execution rechecks current settings and selected agent scope', async () => {
  updateWorkspace('ws', { settings: { sessionSearch: settings } });
  updateSession('s', { agentId: 'agent' });
  const ids: Array<string | null> = [];
  const bridge = { definitions: () => defs,
    execute: async (_input: Record<string, unknown>, _ws: string, _session: string,
      _include: boolean, _risk: PermissionRiskLevel, _ask: (request: PermissionAsk) => Promise<boolean>,
      agentId: string | null) => {
      ids.push(agentId);
      return { success: true };
    } };
  const tools = createCodexSessionSearchTools({ bridge, sessionId: 's', workspaceId: 'ws',
    preconfigId: 'agent', agentDir: '/agent', isActive: () => true, authorizeRoot: () => true });
  expect((await tools.call(call('read', { sessionId: 's', scope: 'agent' }))).success).toBe(true);
  expect(ids).toEqual(['agent']);
  updateSession('s', { agentId: 'other' });
  expect((await tools.call(call('list', { action: 'list', scope: 'agent' }))).success).toBe(false);
});
