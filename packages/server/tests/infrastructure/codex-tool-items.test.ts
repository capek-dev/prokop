import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { ServerMessage, ToolPart } from '@prokopai/sdk';
import type { ToolCatalogEntry } from '@/application/ports/tool-catalog';
import { projectMessagesForClient } from '@/application/sessions/tool-debug';
import { CodexToolItems } from '@/harnesses/codex-cli/tool-items';
import { createMessage, createPart, listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { createTestAssistantMessage } from '#tests/factories';
import { seedWorkspace } from '#tests/seed';

beforeEach(() => {
  setupTestDatabase();
  seedWorkspace({ id: 'ws', path: process.cwd() });
  createSession({ id: 's', workspaceId: 'ws', title: 'Test', status: 'active',
    preconfigId: 'agent', metadata: null, parentId: null, agentName: null, harness: 'codex-cli' });
});
afterEach(() => resetTestDatabase());

test('unclassified native tool items get bounded generic rows on live events and reload', async () => {
  const assistant = createMessage(createTestAssistantMessage('s'));
  const sent: ServerMessage[] = [];
  const items = new CodexToolItems('s', assistant.id, 'turn', {
    send: (_origin, message) => { sent.push(message); },
    broadcast: message => { sent.push(message); },
    broadcastToSession: (_id, message) => { sent.push(message); },
    sendToController: (_id, message) => { sent.push(message); },
    sendToAskTargets: (_id, _authority, message) => { sent.push(message); },
  });
  const long = 'a'.repeat(12_000);
  const call = { id: 'external-1', type: 'extensionToolCall', server: 'user-plugin',
    tool: 'lookup', arguments: { query: long }, status: 'inProgress' };
  items.started(call);
  items.started(call);
  items.completed({ ...call, status: 'completed', result: long });
  items.completed({ id: 'external-2', type: 'pluginInvocation', tool: 'search', status: 'failed' });
  items.started({ id: 'not-a-tool', type: 'agentMessage', text: 'Do not show as a tool' });
  items.started({ id: 'missing-tool', type: 'extensionToolCall', arguments: {} });
  items.started({ id: '', type: 'extensionToolCall', tool: 'search' });
  const stored = listMessagesWithParts('s');
  const parts = stored[0]!.parts.filter((part): part is ToolPart => part.type === 'tool');
  expect(parts).toHaveLength(2);
  expect(parts[0]).toMatchObject({ name: 'user-plugin: lookup',
    presentation: { summary: 'user-plugin: lookup' }, state: { status: 'completed' } });
  expect(parts[1]).toMatchObject({ presentation: { summary: 'search' }, state: { status: 'error' } });
  expect(JSON.stringify(parts[0])).not.toContain(long);
  expect(JSON.stringify(sent)).not.toContain(long);
  expect(sent.filter(message => message.type === 'part.created')).toHaveLength(2);
  expect(sent.filter(message => message.type === 'part.updated')).toHaveLength(2);
  const visible = await projectMessagesForClient(stored);
  expect((visible[0]!.parts[0] as ToolPart).presentation).toMatchObject({
    summary: 'user-plugin: lookup', visualization: { type: 'markdown' },
  });
});

test('Codex memory and session search use the Prokop row shapes on live events and reload', async () => {
  const assistant = createMessage(createTestAssistantMessage('s'));
  const sent: ServerMessage[] = [];
  const items = new CodexToolItems('s', assistant.id, 'turn', {
    send: (_origin, message) => { sent.push(message); },
    broadcast: message => { sent.push(message); },
    broadcastToSession: (_id, message) => { sent.push(message); },
    sendToController: (_id, message) => { sent.push(message); },
    sendToAskTargets: (_id, _authority, message) => { sent.push(message); },
  });
  const complete = (id: string, tool: string, args: Record<string, unknown>, result: unknown) =>
    items.completed({ id, type: 'dynamicToolCall', namespace: null, tool, status: 'completed',
      arguments: args, contentItems: [{ type: 'inputText', text: JSON.stringify(result) }] });
  complete('workspace', 'memory', { action: 'list', target: 'user' },
    { action: 'list', target: 'user', usage: { chars: 12, limit: 1500 }, entries: ['[0] private entry'] });
  complete('agent', 'agent_memory', { action: 'list', target: 'memory' },
    { action: 'list', target: 'memory', usage: { chars: 4, limit: 2500 }, entries: ['[0] secret'] });
  complete('updated', 'agent_memory', { action: 'add', target: 'user' },
    { action: 'add', target: 'user' });
  complete('list', 'session_search', { action: 'list' },
    { success: true, mode: 'list', sessions: [{ id: 's', title: 'Earlier discussion' }] });
  complete('read', 'session_search', { action: 'read', sessionId: 's' },
    { success: true, mode: 'read', sessionTitle: 'Earlier discussion',
      messages: [{ content: '![image](https://example.com/external.png)' }] });
  complete('denied', 'session_search', { query: 'private' }, { error: 'USER_REJECTION' });
  const stored = listMessagesWithParts('s');
  const parts = stored[0]!.parts.filter((part): part is ToolPart => part.type === 'tool');
  const viz = (id: string) => {
    const part = parts.find(part => part.callId === `codex-item:turn:${id}`);
    return part?.state.status === 'completed'
      ? (part.state.output as { _visualization: unknown })._visualization : null;
  };
  expect(viz('workspace')).toEqual({ type: 'none', badge: '1 entry · 12/1500 chars', message: 'Memory (user)' });
  expect(viz('agent')).toEqual({ type: 'none', badge: '1 entry', message: 'Agent memory (memory)' });
  expect(viz('updated')).toEqual({ type: 'none', message: 'Agent memory updated' });
  expect(viz('list')).toEqual({ type: 'file-list', badge: '1 session', singularLabel: 'session',
    pluralLabel: 'sessions', files: [{ path: 'Earlier discussion' }], total: 1 });
  expect(viz('read')).toEqual({ type: 'none', badge: '1 message', message: 'Earlier discussion' });
  expect(viz('denied')).toEqual({ type: 'none', message: 'USER_REJECTION' });
  expect(parts.map(part => [part.callId, part.name]).sort()).toEqual([
    ['codex-item:turn:workspace', 'memory'], ['codex-item:turn:agent', 'agent_memory'],
    ['codex-item:turn:updated', 'agent_memory'], ['codex-item:turn:list', 'session_search'],
    ['codex-item:turn:read', 'session_search'], ['codex-item:turn:denied', 'session_search'],
  ].sort());
  const catalog = { listTools: async () => [
    { name: 'memory', display: { summary: '{action} {target}' }, source: 'domain' },
    { name: 'agent_memory', display: { summary: '{action} {target}' }, source: 'domain' },
    { name: 'session_search', display: { summary: '{action} {query}' }, source: 'domain' },
  ] as ToolCatalogEntry[] };
  const projected = await projectMessagesForClient(stored, catalog);
  const visible = projected[0]!.parts.filter((part): part is ToolPart => part.type === 'tool');
  expect(visible.find(part => part.callId === 'codex-item:turn:workspace')?.presentation)
    .toMatchObject({ summary: 'list user',
      visualization: { type: 'none', badge: '1 entry · 12/1500 chars' } });
  expect(visible.find(part => part.callId === 'codex-item:turn:list')?.presentation)
    .toMatchObject({ visualization: { type: 'file-list', files: [{ path: 'Earlier discussion' }] } });
  expect(JSON.stringify(projected)).not.toContain('private entry');
  expect(JSON.stringify(projected)).not.toContain('external.png');
  expect(sent.filter(message => message.type === 'part.updated')).toHaveLength(6);
});

test('Codex agent skill management projects list, mutation and failure results without raw JSON', async () => {
  const assistant = createMessage(createTestAssistantMessage('s'));
  const sent: ServerMessage[] = [];
  const items = new CodexToolItems('s', assistant.id, 'turn', {
    send: (_origin, message) => { sent.push(message); },
    broadcast: message => { sent.push(message); },
    broadcastToSession: (_id, message) => { sent.push(message); },
    sendToController: (_id, message) => { sent.push(message); },
    sendToAskTargets: (_id, _authority, message) => { sent.push(message); },
  });
  const complete = (id: string, args: Record<string, unknown>, result: unknown) =>
    items.completed({ id, type: 'dynamicToolCall', namespace: null, tool: 'agent_skill_manage',
      status: 'completed', arguments: args,
      contentItems: [{ type: 'inputText', text: typeof result === 'string' ? result : JSON.stringify(result) }] });
  complete('list', { action: 'list' }, { success: true, action: 'list', skills: [
    { name: 'review', description: 'Review changes' }, { name: 'build', description: 'Build project' },
  ] });
  complete('create', { action: 'create', name: 'review', content: 'Sensitive skill body' },
    { success: true, action: 'create', title: 'Skill created: review',
      path: 'review/SKILL.md', summary: 'Created workspace skill.' });
  complete('denied', { action: 'patch', name: 'review' }, { error: 'Skill not found' });
  complete('malformed', { action: 'update', name: 'review' }, '{"invalid":');
  const stored = listMessagesWithParts('s');
  const parts = stored[0]!.parts.filter((part): part is ToolPart => part.type === 'tool');
  const viz = (id: string) => {
    const part = parts.find(part => part.callId === `codex-item:turn:${id}`)!;
    return part.state.status === 'completed'
      ? (part.state.output as { _visualization: unknown })._visualization : null;
  };
  expect(viz('list')).toEqual({ type: 'file-list', badge: '2 skills', singularLabel: 'skill',
    pluralLabel: 'skills', title: 'Agent skills', files: [
      { path: 'review', content: 'Review changes' }, { path: 'build', content: 'Build project' },
    ], total: 2 });
  expect(viz('create')).toEqual({ type: 'none', message: 'Skill created: review' });
  expect(viz('denied')).toEqual({ type: 'none', message: 'Skill not found' });
  expect(viz('malformed')).toEqual({ type: 'none', message: 'Agent skill result unavailable' });
  expect(parts.map(part => [part.name, part.presentation?.summary]).sort()).toEqual([
    ['agent_skill_manage', 'list'], ['agent_skill_manage', 'create review'],
    ['agent_skill_manage', 'patch review'], ['agent_skill_manage', 'update review'],
  ].sort());
  const projected = await projectMessagesForClient(stored);
  const visible = projected[0]!.parts.filter((part): part is ToolPart => part.type === 'tool');
  expect(visible.find(part => part.callId === 'codex-item:turn:create')?.presentation)
    .toMatchObject({ summary: 'create review', visualization: { type: 'none', message: 'Skill created: review' } });
  expect(visible.find(part => part.callId === 'codex-item:turn:list')?.presentation)
    .toMatchObject({ summary: 'list', visualization: { type: 'file-list', badge: '2 skills' } });
  expect(JSON.stringify(sent)).not.toContain('Sensitive skill body');
  expect(JSON.stringify(projected)).not.toContain('Sensitive skill body');
  expect(JSON.stringify(projected)).not.toContain('Created workspace skill.');
  expect(JSON.stringify(projected)).not.toContain('{\\"success\\"');
});

test('Codex agent wait shows a status instead of raw JSON in live events and on reload', async () => {
  const assistant = createMessage(createTestAssistantMessage('s'));
  const sent: ServerMessage[] = [];
  const items = new CodexToolItems('s', assistant.id, 'turn', {
    send: (_origin, message) => { sent.push(message); },
    broadcast: message => { sent.push(message); },
    broadcastToSession: (_id, message) => { sent.push(message); },
    sendToController: (_id, message) => { sent.push(message); },
    sendToAskTargets: (_id, _authority, message) => { sent.push(message); },
  });
  items.completed({ id: 'wait', type: 'collabAgentToolCall', tool: 'wait', status: 'completed',
    prompt: 'Explore privately', result: { status: 'completed', secret: 'private response' } });
  const stored = listMessagesWithParts('s');
  const part = stored[0]!.parts.find(entry => entry.type === 'tool') as ToolPart;
  expect(part.presentation?.summary).toBe('wait');
  expect(part.state).toMatchObject({ output: { _visualization: {
    type: 'none', message: 'Subagent wait completed',
  } } });
  expect(JSON.stringify(sent)).not.toContain('private response');
  const projected = await projectMessagesForClient(stored);
  expect((projected[0]!.parts.find(entry => entry.type === 'tool') as ToolPart).presentation)
    .toMatchObject({ summary: 'wait', visualization: { type: 'none', message: 'Subagent wait completed' } });
  expect(JSON.stringify(projected)).not.toContain('private response');
  expect(JSON.stringify(projected)).not.toContain('Explore privately');
});

test('previous Codex agent wait rows hide persisted JSON and prompt on reload', async () => {
  const assistant = createMessage(createTestAssistantMessage('s'));
  createPart({ id: crypto.randomUUID(), messageId: assistant.id, createdAt: Date.now(), type: 'tool',
    callId: 'codex-item:turn:old-wait', name: 'subagent',
    state: { status: 'completed', input: { tool: 'wait', prompt: 'private prompt' },
      output: { _visualization: { type: 'none', message: 'Subagent wait completed' } },
      startedAt: Date.now(), completedAt: Date.now() },
    presentation: { summary: 'wait', debugAvailable: false } }, 's');
  const projected = await projectMessagesForClient(listMessagesWithParts('s'));
  const part = projected[0]!.parts.find(entry => entry.type === 'tool') as ToolPart;
  expect(part.presentation).toMatchObject({ summary: 'wait',
    visualization: { type: 'none', message: 'Subagent wait completed' } });
  expect(JSON.stringify(projected)).not.toContain('private prompt');
  expect(JSON.stringify(projected)).not.toContain('"secret"');
});

test('agent skill rows with malformed results stay bounded on reload', async () => {
  const assistant = createMessage(createTestAssistantMessage('s'));
  createPart({ id: crypto.randomUUID(), messageId: assistant.id, createdAt: Date.now(), type: 'tool',
    callId: 'codex-item:turn:old', name: 'agent_skill_manage',
    state: { status: 'completed', input: { action: 'create', name: 'review' },
      output: { _visualization: { type: 'none', message: 'Skill created: review' } },
      startedAt: Date.now(), completedAt: Date.now() },
    presentation: { summary: 'create review', debugAvailable: false } }, 's');
  const projected = await projectMessagesForClient(listMessagesWithParts('s'));
  const part = projected[0]!.parts.find(part => part.type === 'tool') as ToolPart;
  expect(part.presentation).toMatchObject({ summary: 'create review',
    visualization: { type: 'none', message: 'Skill created: review' } });
  expect(JSON.stringify(projected)).not.toContain('"success":true');
});
