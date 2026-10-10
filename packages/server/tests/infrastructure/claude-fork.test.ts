import { beforeEach, afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SDKMessage, SDKUserMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { Paths } from '@/infrastructure/runtime/paths';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { updateSession } from '@/infrastructure/sqlite/session-store';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { createPart, listMessagesWithParts, updateMessage } from '@/infrastructure/sqlite/message-store';
import { getClaudeModelSelection, saveClaudeModelSelection } from '@/harnesses/claude-cli/models';
import { createClaudeExecution } from '@/harnesses/claude-cli/execution';

const root = realpathSync(process.cwd());

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(process.cwd(), '.claude-fork-test-'));
  mkdirSync(join(dataDir, 'tools'));
  Paths.configure({ dataDir });
  setupTestDatabase();
  seedWorkspace({ id: 'ws', path: process.cwd() });
  createSession({ id: 'session', workspaceId: 'ws', title: 'Claude', status: 'active',
    preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'claude-cli' });
  saveClaudeModelSelection('session', { model: 'claude-sonnet-5', effort: 'medium' });
});
afterEach(() => { resetTestDatabase(); Paths.reset(); rmSync(dataDir, { recursive: true, force: true }); });

function fixture() {
  const events: unknown[] = [];
  const wire = { actor: { attachOriginToSession: () => {} }, delivery: {
    send: (_origin: string, value: unknown) => events.push(value),
    broadcastToSession: (_id: string, value: unknown) => events.push(value),
    broadcast: (value: unknown) => events.push(value),
  } } as unknown as SessionWirePorts<string>;
  const histories = new Map<string, SessionMessage[]>();
  const forkCalls: string[] = [];
  let forkError = false;
  let badCopy = false;
  const exec = createClaudeExecution({ version: () => '2.1.274',
    start: (prompt, options) => {
      const sessionId = options.sessionId ?? options.resume!;
      async function* messages(): AsyncGenerator<SDKMessage> {
        const text = typeof prompt === 'string' ? prompt : (await prompt[Symbol.asyncIterator]().next()).value as SDKUserMessage;
        const content = typeof text === 'string' ? text : text.message.content;
        const userId = typeof text === 'string' ? crypto.randomUUID() : text.uuid!;
        const native = histories.get(sessionId) ?? [];
        // Like Claude Code: a prompt after an unanswered prompt gets a synthetic placeholder reply first.
        if (native.at(-1)?.type === 'user') {
          native.push({ type: 'assistant', uuid: crypto.randomUUID(), session_id: sessionId, parent_tool_use_id: null,
            parent_agent_id: null, message: { role: 'assistant', model: '<synthetic>',
              content: [{ type: 'text', text: 'No response requested.' }] } });
        }
        native.push({ type: 'user', uuid: userId, session_id: sessionId, parent_tool_use_id: null,
          parent_agent_id: null, message: { role: 'user', content } });
        native.push({ type: 'assistant', uuid: crypto.randomUUID(), session_id: sessionId, parent_tool_use_id: null,
          parent_agent_id: null, message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } });
        histories.set(sessionId, native);
        yield { type: 'system', subtype: 'init', session_id: sessionId } as SDKMessage;
        yield { type: 'assistant', session_id: sessionId, parent_tool_use_id: null,
          message: { content: [{ type: 'text', text: 'reply' }] } } as SDKMessage;
        yield { type: 'result', subtype: 'success', session_id: sessionId, result: 'reply' } as SDKMessage;
      }
      return messages();
    },
    readHistory: async id => histories.get(id) ?? [],
    forkHistory: async (id, options) => {
      forkCalls.push(options?.upToMessageId ?? 'missing');
      if (forkError) throw new Error('private upstream error');
      const source = histories.get(id)!;
      const cutoff = source.findIndex(item => item.uuid === options?.upToMessageId);
      const newId = crypto.randomUUID();
      histories.set(newId, source.slice(0, badCopy ? cutoff : cutoff + 1).map(item =>
        ({ ...item, uuid: crypto.randomUUID(), session_id: newId })));
      return { sessionId: newId };
    },
  });
  const binding = (sessionId: string) => getDatabase().query<{ native_session_id: string; pending: number }, [string]>(
    'SELECT native_session_id, pending FROM claude_session_bindings WHERE session_id = ?').get(sessionId);
  const forkIntent = () => getDatabase().query<{ target_message_id: string }, [string]>(
    'SELECT target_message_id FROM claude_fork_intents WHERE source_session_id = ?').get('session');
  return { exec, wire, events, histories, forkCalls, binding, forkIntent,
    failFork: () => { forkError = true; }, badFork: () => { badCopy = true; } };
}

async function twoTurns(f: ReturnType<typeof fixture>) {
  await f.exec.sendMessage(f.wire, 'origin', 'session', 'first');
  await f.exec.sendMessage(f.wire, 'origin', 'session', 'second');
  return listMessagesWithParts('session');
}

test('fork keeps the selected reply in a bound native fork and resumes it on the next message', async () => {
  const f = fixture();
  const local = await twoTurns(f);
  const oldBinding = f.binding('session')!;
  const result = await f.exec.fork({ sessionId: 'session', targetMessageId: local[1]!.message.id });
  expect(f.forkCalls).toEqual([f.histories.get(oldBinding.native_session_id)![1]!.uuid]);
  expect(result.forkedSession).toMatchObject({ harness: 'claude-cli', workspaceId: 'ws',
    title: 'Claude (fork)', metadata: { forkedFrom: 'session' } });
  const forkId = result.forkedSession.id;
  const forkBinding = f.binding(forkId)!;
  expect(forkBinding.pending).toBe(0);
  expect(forkBinding.native_session_id).not.toBe(oldBinding.native_session_id);
  expect(getDatabase().query<{ workspace_root: string; cli_version: string }, [string]>(
    'SELECT workspace_root, cli_version FROM claude_session_bindings WHERE session_id = ?').get(forkId))
    .toEqual({ workspace_root: root, cli_version: '2.1.274' });
  expect(getClaudeModelSelection(forkId)).toEqual({ model: 'claude-sonnet-5', effort: 'medium' });
  const copy = listMessagesWithParts(forkId);
  expect(copy).toHaveLength(2);
  expect(copy[0]!.message.id).not.toBe(local[0]!.message.id);
  expect(copy[0]!.parts[0]).toMatchObject({ type: 'text', text: 'first' });
  expect(copy[1]!.parts[0]).toMatchObject({ type: 'text', text: 'reply' });
  expect(getDatabase().query('SELECT message_id, native_user_id FROM claude_inherited_user_ids').all())
    .toEqual([{ message_id: copy[0]!.message.id,
      native_user_id: f.histories.get(forkBinding.native_session_id)![0]!.uuid }]);
  expect(listMessagesWithParts('session')).toHaveLength(4);
  expect(f.binding('session')!.native_session_id).toBe(oldBinding.native_session_id);
  expect(f.forkIntent()).toBeNull();
  await f.exec.sendMessage(f.wire, 'origin', forkId, 'third');
  expect(listMessagesWithParts(forkId)).toHaveLength(4);
  expect(f.histories.get(forkBinding.native_session_id)!).toHaveLength(4);
  expect(f.binding(forkId)!.native_session_id).toBe(forkBinding.native_session_id);
});

test('fork at the last reply retains the whole conversation', async () => {
  const f = fixture();
  const local = await twoTurns(f);
  const oldBinding = f.binding('session')!;
  const result = await f.exec.fork({ sessionId: 'session', targetMessageId: local[3]!.message.id });
  expect(f.forkCalls).toEqual([f.histories.get(oldBinding.native_session_id)![3]!.uuid]);
  expect(listMessagesWithParts(result.forkedSession.id)).toHaveLength(4);
  expect(f.forkIntent()).toBeNull();
});

test('lost fork keeps the intent, refuses retries, and leaves chat usable', async () => {
  const f = fixture();
  const local = await twoTurns(f);
  f.failFork();
  await expect(f.exec.fork({ sessionId: 'session', targetMessageId: local[1]!.message.id }))
    .rejects.toThrow('uncertain');
  expect(f.forkIntent()).not.toBeNull();
  expect(listMessagesWithParts('session')).toHaveLength(4);
  await expect(f.exec.fork({ sessionId: 'session', targetMessageId: local[3]!.message.id }))
    .rejects.toThrow('Claude fork outcome is uncertain; do not retry in this session');
  await f.exec.sendMessage(f.wire, 'origin', 'session', 'third');
  expect(listMessagesWithParts('session')).toHaveLength(6);
});

test('unverifiable fork copy refuses before creating any session', async () => {
  const f = fixture();
  const local = await twoTurns(f);
  f.badFork();
  await expect(f.exec.fork({ sessionId: 'session', targetMessageId: local[1]!.message.id }))
    .rejects.toThrow('uncertain');
  expect(f.forkIntent()).not.toBeNull();
  expect(getDatabase().query('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 });
  expect(listMessagesWithParts('session')).toHaveLength(4);
});

test('fork at a user message keeps a user-only cutoff that resumes on the next message', async () => {
  const f = fixture();
  const local = await twoTurns(f);
  const native = f.histories.get(f.binding('session')!.native_session_id)!;
  const result = await f.exec.fork({ sessionId: 'session', targetMessageId: local[2]!.message.id });
  expect(f.forkCalls).toEqual([native[2]!.uuid]); // cutoff: the second user message itself
  const forkId = result.forkedSession.id;
  const copy = listMessagesWithParts(forkId);
  expect(copy).toHaveLength(3);
  expect(copy[2]?.message.role).toBe('user');
  const forkNative = f.histories.get(f.binding(forkId)!.native_session_id)!;
  const inherited = getDatabase().query('SELECT native_user_id FROM claude_inherited_user_ids')
    .all() as Array<{ native_user_id: string }>;
  expect(new Set(inherited.map(row => row.native_user_id)))
    .toEqual(new Set([forkNative[0]!.uuid, forkNative[2]!.uuid]));
  await f.exec.sendMessage(f.wire, 'origin', forkId, 'third');
  expect(listMessagesWithParts(forkId)).toHaveLength(5);
  expect(listMessagesWithParts('session')).toHaveLength(4);
  expect(f.forkIntent()).toBeNull();
});

test('fork at the first user message creates a prompt-only fork', async () => {
  const f = fixture();
  const local = await twoTurns(f);
  const native = f.histories.get(f.binding('session')!.native_session_id)!;
  const result = await f.exec.fork({ sessionId: 'session', targetMessageId: local[0]!.message.id });
  expect(f.forkCalls).toEqual([native[0]!.uuid]);
  const forkId = result.forkedSession.id;
  expect(listMessagesWithParts(forkId)).toHaveLength(1);
  await f.exec.sendMessage(f.wire, 'origin', forkId, 'continue');
  expect(listMessagesWithParts(forkId)).toHaveLength(3);
});

test('goal, compact, rollback-locked, image, and errored-reply targets refuse fork', async () => {
  const f = fixture();
  const local = await twoTurns(f);
  updateMessage(local[3]!.message.id, { status: 'error' });
  await expect(f.exec.fork({ sessionId: 'session', targetMessageId: local[3]!.message.id }))
    .rejects.toThrow('completed assistant response or a user message');
  updateSession('session', { metadata: { claudeGoal: { condition: 'x', status: 'ended', iterations: 1 } } });
  await expect(f.exec.fork({ sessionId: 'session', targetMessageId: local[1]!.message.id }))
    .rejects.toThrow('cannot be forked');
  updateSession('session', { metadata: { claudeCompactedAt: Date.now() } });
  await expect(f.exec.fork({ sessionId: 'session', targetMessageId: local[1]!.message.id }))
    .rejects.toThrow('cannot be forked');
  updateSession('session', { metadata: {} });
  getDatabase().run(`INSERT INTO claude_rollback_intents
    (session_id, operation, target_message_id, phase) VALUES ('session', 'edit', 'x', 'fork')`);
  await expect(f.exec.fork({ sessionId: 'session', targetMessageId: local[1]!.message.id }))
    .rejects.toThrow('recovery before fork');
  getDatabase().run('DELETE FROM claude_rollback_intents WHERE session_id = ?', ['session']);
  createPart({ id: crypto.randomUUID(), messageId: local[0]!.message.id, type: 'image',
    url: '/image', mimeType: 'image/png', createdAt: Date.now() }, 'session');
  await expect(f.exec.fork({ sessionId: 'session', targetMessageId: local[1]!.message.id }))
    .rejects.toThrow('image history');
  expect(f.forkCalls).toEqual([]);
  expect(f.forkIntent()).toBeNull();
  expect(listMessagesWithParts('session')).toHaveLength(4);
});

async function forkAtPromptThenSend(f: ReturnType<typeof fixture>) {
  const local = await twoTurns(f);
  const { forkedSession } = await f.exec.fork({ sessionId: 'session', targetMessageId: local[2]!.message.id });
  await f.exec.sendMessage(f.wire, 'origin', forkedSession.id, 'third');
  const copy = listMessagesWithParts(forkedSession.id);
  // first, reply, second (unanswered), third, reply
  expect(copy.map(entry => entry.message.role)).toEqual(['user', 'assistant', 'user', 'user', 'assistant']);
  return { forkId: forkedSession.id, copy };
}

test('edit after a fork at a user message resends the edited prompt', async () => {
  const f = fixture();
  const { forkId, copy } = await forkAtPromptThenSend(f);
  await f.exec.editMessage(f.wire, 'origin', { sessionId: forkId, messageId: copy[3]!.message.id, content: 'third, edited' });
  expect(f.events).not.toContainEqual(expect.objectContaining({ type: 'error' }));
  const after = listMessagesWithParts(forkId);
  expect(after.map(entry => entry.message.role)).toEqual(['user', 'assistant', 'user', 'user', 'assistant']);
  expect(after[3]!.parts[0]).toMatchObject({ type: 'text', text: 'third, edited' });
});

test('the unanswered prompt itself can be edited', async () => {
  const f = fixture();
  const { forkId, copy } = await forkAtPromptThenSend(f);
  await f.exec.editMessage(f.wire, 'origin', { sessionId: forkId, messageId: copy[2]!.message.id, content: 'second, edited' });
  expect(f.events).not.toContainEqual(expect.objectContaining({ type: 'error' }));
  const after = listMessagesWithParts(forkId);
  expect(after.map(entry => entry.message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  expect(after[2]!.parts[0]).toMatchObject({ type: 'text', text: 'second, edited' });
});

test('undo and fork work across an unanswered prompt', async () => {
  const f = fixture();
  const { forkId, copy } = await forkAtPromptThenSend(f);
  const nested = await f.exec.fork({ sessionId: forkId, targetMessageId: copy[4]!.message.id });
  expect(listMessagesWithParts(nested.forkedSession.id).map(entry => entry.message.role))
    .toEqual(['user', 'assistant', 'user', 'user', 'assistant']);
  const result = await f.exec.revert({ sessionId: forkId, targetMessageId: copy[1]!.message.id });
  expect(result.removed.messageIds).toEqual(copy.slice(2).map(entry => entry.message.id));
  expect(listMessagesWithParts(forkId)).toHaveLength(2);
});
