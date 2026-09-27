import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { ServerMessage, ToolPart } from '@prokopai/sdk';
import type { ToolCatalogEntry } from '@/application/ports/tool-catalog';
import { projectMessagesForClient } from '@/application/sessions/tool-debug';
import { CodexToolItems } from '@/harnesses/codex-cli/tool-items';
import { createMessage, listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
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
