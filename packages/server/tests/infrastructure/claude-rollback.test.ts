import { beforeEach, afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SDKMessage, SDKUserMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { Paths } from '@/infrastructure/runtime/paths';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { createPart, listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { saveClaudeModelSelection } from '@/harnesses/claude-cli/models';
import { createClaudeExecution } from '@/harnesses/claude-cli/execution';
import { installHarnessNotificationPort } from '@/application/ports/harness-notifications';

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(process.cwd(), '.claude-rollback-test-'));
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
  let failNextTurn = false;
  let splitReplies = false;
  let stopNextTurn = false;
  const exec = createClaudeExecution({ version: () => '2.1.274',
    start: (prompt, options) => {
      const sessionId = options.sessionId ?? options.resume!;
      async function* messages(): AsyncGenerator<SDKMessage> {
        if (failNextTurn) { failNextTurn = false; throw new Error('fake failed after submission'); }
        const text = typeof prompt === 'string' ? prompt : (await prompt[Symbol.asyncIterator]().next()).value as SDKUserMessage;
        const content = typeof text === 'string' ? text : text.message.content;
        const userId = typeof text === 'string' ? crypto.randomUUID() : text.uuid!;
        const native = histories.get(sessionId) ?? [];
        native.push({ type: 'user', uuid: userId, session_id: sessionId, parent_tool_use_id: null,
          parent_agent_id: null, message: { role: 'user', content } });
        if (stopNextTurn) {
          // Stop lands mid-reply: native history keeps the prompt and a partial tool turn.
          stopNextTurn = false;
          native.push({ type: 'assistant', uuid: crypto.randomUUID(), session_id: sessionId,
            parent_tool_use_id: null, parent_agent_id: null, message: { role: 'assistant',
              content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: {} }] } });
          histories.set(sessionId, native);
          yield { type: 'system', subtype: 'init', session_id: sessionId } as SDKMessage;
          await exec.interruptSession('session');
          yield { type: 'stream_event', session_id: sessionId, parent_tool_use_id: null,
            event: { type: 'message_start' } } as unknown as SDKMessage;
          return;
        }
        if (splitReplies) native.push({ type: 'assistant', uuid: crypto.randomUUID(), session_id: sessionId,
          parent_tool_use_id: null, parent_agent_id: null,
          message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'private' }] } });
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
  const binding = () => getDatabase().query<{ native_session_id: string; pending: number }, []>(
    'SELECT native_session_id, pending FROM claude_session_bindings').get();
  const pending = () => getDatabase().query<{ phase: string }, []>('SELECT phase FROM claude_rollback_intents').get();
  return { exec, wire, events, histories, forkCalls, binding, pending,
    failFork: () => { forkError = true; }, badFork: () => { badCopy = true; },
    failTurn: () => { failNextTurn = true; }, splitReplies: () => { splitReplies = true; },
    stopTurn: () => { stopNextTurn = true; } };
}

async function twoTurns(f: ReturnType<typeof fixture>) {
  await f.exec.sendMessage(f.wire, 'origin', 'session', 'first');
  await f.exec.sendMessage(f.wire, 'origin', 'session', 'second');
  return listMessagesWithParts('session');
}

test('Undo preserves preceding turn, switches native binding, and subsequent chat resumes the fork', async () => {
  const f = fixture();
  const local = await twoTurns(f);
  const oldId = f.binding()!.native_session_id;
  const previousNativeAssistant = f.histories.get(oldId)![1]!.uuid;
  f.histories.get(oldId)![1]!.message = { role: 'assistant', content: [
    { type: 'thinking', thinking: 'private' }, { type: 'text', text: 'reply' }] };
  const result = await f.exec.revert({ sessionId: 'session', targetMessageId: local[1]!.message.id });
  expect(result.removed.messageIds).toEqual(local.slice(2).map(item => item.message.id));
  expect(f.forkCalls).toEqual([previousNativeAssistant]);
  expect(f.binding()!.native_session_id).not.toBe(oldId);
  expect(f.pending()).toBeNull();
  expect(listMessagesWithParts('session')).toHaveLength(2);
  await f.exec.sendMessage(f.wire, 'origin', 'session', 'third');
  expect(listMessagesWithParts('session')).toHaveLength(4);
  expect(f.binding()?.pending).toBe(0);
  const next = listMessagesWithParts('session');
  await f.exec.revert({ sessionId: 'session', targetMessageId: next[1]!.message.id });
  expect(listMessagesWithParts('session')).toHaveLength(2);
  expect(f.forkCalls).toHaveLength(2);
  await f.exec.revert({ sessionId: 'session', targetMessageId: next[0]!.message.id });
  expect(listMessagesWithParts('session')).toHaveLength(0);
  expect(f.binding()).toBeNull();
});

test('Undo first turn clears conversation and starts a fresh native session on next send', async () => {
  const f = fixture();
  const local = await twoTurns(f);
  const result = await f.exec.revert({ sessionId: 'session', targetMessageId: local[0]!.message.id });
  expect(result.revertedTo.messageId).toBeNull();
  expect(listMessagesWithParts('session')).toHaveLength(0);
  expect(f.binding()).toBeNull();
  expect(f.forkCalls).toEqual([]);
  await f.exec.sendMessage(f.wire, 'origin', 'session', 'again');
  expect(f.binding()?.pending).toBe(0);
});

test('Edit retains the user message ID, drops later turns, and submits edited text once', async () => {
  const f = fixture();
  const local = await twoTurns(f);
  await f.exec.editMessage(f.wire, 'origin', { sessionId: 'session', messageId: local[2]!.message.id,
    content: 'replacement' });
  const after = listMessagesWithParts('session');
  expect(after.map(item => item.message.id)).toEqual([local[0]!.message.id, local[1]!.message.id,
    local[2]!.message.id, expect.any(String)]);
  expect(after[2]?.parts[0]).toMatchObject({ type: 'text', text: 'replacement' });
  expect(f.pending()).toBeNull();
  expect(f.binding()?.pending).toBe(0);
  expect(f.histories.get(f.binding()!.native_session_id)?.[2]?.uuid).toBe(local[2]!.message.id);
});

test.each(['lost', 'bad'] as const)('%s fork locks history without changing local messages', async kind => {
  const f = fixture();
  const local = await twoTurns(f);
  if (kind === 'lost') f.failFork(); else f.badFork();
  await expect(f.exec.revert({ sessionId: 'session', targetMessageId: local[1]!.message.id })).rejects.toThrow();
  expect(listMessagesWithParts('session')).toHaveLength(4);
  expect(f.pending()?.phase).toBe('fork');
  await expect(f.exec.revert({ sessionId: 'session', targetMessageId: local[1]!.message.id })).rejects.toThrow('recovery');
  await f.exec.sendMessage(f.wire, 'origin', 'session', 'must not replay');
  expect(f.binding()?.pending).toBe(0);
  expect(listMessagesWithParts('session')).toHaveLength(4);
});

test('Edit on the first turn creates a fresh native session without duplicating the user row', async () => {
  const f = fixture();
  const local = await twoTurns(f);
  const oldId = f.binding()!.native_session_id;
  await f.exec.editMessage(f.wire, 'origin', { sessionId: 'session', messageId: local[0]!.message.id,
    content: 'revised first' });
  const after = listMessagesWithParts('session');
  expect(after).toHaveLength(2);
  expect(after[0]?.message.id).toBe(local[0]!.message.id);
  expect(after[0]?.parts[0]).toMatchObject({ text: 'revised first' });
  expect(f.binding()?.native_session_id).not.toBe(oldId);
  expect(f.forkCalls).toEqual([]);
});

test('failed edited resubmission stays locked across executors and does not replay', async () => {
  const f = fixture();
  const local = await twoTurns(f);
  f.failTurn();
  await f.exec.editMessage(f.wire, 'origin', { sessionId: 'session', messageId: local[2]!.message.id,
    content: 'revised' });
  expect(f.pending()?.phase).toBe('sent');
  expect(f.binding()?.pending).toBe(1);
  const fresh = createClaudeExecution({ version: () => '2.1.274',
    start: () => { throw new Error('must not launch'); } });
  await fresh.sendMessage(f.wire, 'origin', 'session', 'later');
  expect(listMessagesWithParts('session')).toHaveLength(4);
  expect(f.pending()?.phase).toBe('sent');
});

test('ambiguous older history refuses Undo before native fork or local deletion', async () => {
  const f = fixture();
  const local = await twoTurns(f);
  const nativeId = f.binding()!.native_session_id;
  f.histories.get(nativeId)![0] = { ...f.histories.get(nativeId)![0]!, uuid: crypto.randomUUID() };
  await expect(f.exec.revert({ sessionId: 'session', targetMessageId: local[1]!.message.id })).rejects.toThrow('not available');
  expect(f.forkCalls).toEqual([]);
  expect(f.pending()).toBeNull();
  expect(listMessagesWithParts('session')).toHaveLength(4);
});

test.each(['image', 'tool'] as const)('%s history refuses Undo without changing any messages', async kind => {
  const f = fixture();
  const local = await twoTurns(f);
  if (kind === 'image') createPart({ id: crypto.randomUUID(), messageId: local[0]!.message.id,
    type: 'image', url: '/image', mimeType: 'image/png', createdAt: Date.now() }, 'session');
  else createPart({ id: crypto.randomUUID(), messageId: local[1]!.message.id, type: 'tool',
    callId: 'claude-tool:dummy', name: 'Claude Read', createdAt: Date.now(),
    state: { status: 'completed', input: {}, output: {}, startedAt: Date.now(), completedAt: Date.now() },
    presentation: { summary: 'Read', debugAvailable: false } }, 'session');
  await expect(f.exec.revert({ sessionId: 'session', targetMessageId: local[1]!.message.id })).rejects.toThrow('not available');
  expect(f.pending()).toBeNull();
  expect(f.forkCalls).toEqual([]);
  expect(listMessagesWithParts('session')).toHaveLength(4);
});

test('thinking-split native turns match, fork at the turn final message, and stay repeatable', async () => {
  const f = fixture();
  f.splitReplies();
  const local = await twoTurns(f);
  const native = f.histories.get(f.binding()!.native_session_id)!;
  expect(native).toHaveLength(6); // user, thinking, text, user, thinking, text
  await f.exec.revert({ sessionId: 'session', targetMessageId: local[1]!.message.id });
  expect(f.forkCalls).toEqual([native[2]!.uuid]); // cutoff: the first turn's final message
  expect(listMessagesWithParts('session')).toHaveLength(2);
  await f.exec.sendMessage(f.wire, 'origin', 'session', 'third');
  expect(listMessagesWithParts('session')).toHaveLength(4);
  await f.exec.revert({ sessionId: 'session', targetMessageId: local[1]!.message.id });
  expect(f.forkCalls).toHaveLength(2);
  expect(listMessagesWithParts('session')).toHaveLength(2);
  await f.exec.revert({ sessionId: 'session', targetMessageId: local[0]!.message.id });
  expect(listMessagesWithParts('session')).toHaveLength(0);
  expect(f.binding()).toBeNull();
});

test('Edit with thinking-split history resubmits once through the fork', async () => {
  const f = fixture();
  f.splitReplies();
  const local = await twoTurns(f);
  await f.exec.editMessage(f.wire, 'origin', { sessionId: 'session', messageId: local[2]!.message.id,
    content: 'replacement' });
  const after = listMessagesWithParts('session');
  expect(after).toHaveLength(4);
  expect(after[2]?.parts[0]).toMatchObject({ type: 'text', text: 'replacement' });
  const fork = f.histories.get(f.binding()!.native_session_id)!;
  expect(fork).toHaveLength(6); // fork prefix user/thinking/text, then resubmitted user, thinking, text
  expect(fork[3]!.uuid).toBe(local[2]!.message.id);
  expect(f.pending()).toBeNull();
});

test('native consecutive user messages refuse Undo before any fork', async () => {
  const f = fixture();
  const local = await twoTurns(f);
  const native = f.histories.get(f.binding()!.native_session_id)!;
  native.splice(2, 0, { ...native[2]!, uuid: crypto.randomUUID() });
  await expect(f.exec.revert({ sessionId: 'session', targetMessageId: local[1]!.message.id })).rejects.toThrow('not available');
  expect(f.pending()).toBeNull();
  expect(f.forkCalls).toEqual([]);
  expect(listMessagesWithParts('session')).toHaveLength(4);
});

test('Edit after stopping the first reply resubmits on a fresh native session', async () => {
  const f = fixture();
  f.stopTurn();
  await f.exec.sendMessage(f.wire, 'origin', 'session', 'first');
  const stopped = listMessagesWithParts('session');
  expect(stopped.map(item => item.message.status ?? null)).toEqual([null, 'interrupted']);
  const oldId = f.binding()!.native_session_id;
  await f.exec.editMessage(f.wire, 'origin', { sessionId: 'session', messageId: stopped[0]!.message.id,
    content: 'revised first' });
  expect(f.events).not.toContainEqual(expect.objectContaining({ code: 'edit_error' }));
  const after = listMessagesWithParts('session');
  expect(after).toHaveLength(2);
  expect(after[0]?.parts[0]).toMatchObject({ text: 'revised first' });
  expect(after[1]?.message).toMatchObject({ role: 'assistant', status: 'completed' });
  expect(f.binding()?.native_session_id).not.toBe(oldId);
  expect(f.forkCalls).toEqual([]);
  expect(f.pending()).toBeNull();
});

test('Edit after stopping a later reply forks at the last completed turn', async () => {
  const f = fixture();
  await f.exec.sendMessage(f.wire, 'origin', 'session', 'first');
  f.stopTurn();
  await f.exec.sendMessage(f.wire, 'origin', 'session', 'second');
  const local = listMessagesWithParts('session');
  const native = f.histories.get(f.binding()!.native_session_id)!;
  await f.exec.editMessage(f.wire, 'origin', { sessionId: 'session', messageId: local[2]!.message.id,
    content: 'replacement' });
  expect(f.events).not.toContainEqual(expect.objectContaining({ code: 'edit_error' }));
  expect(f.forkCalls).toEqual([native[1]!.uuid]);
  const after = listMessagesWithParts('session');
  expect(after).toHaveLength(4);
  expect(after[2]?.parts[0]).toMatchObject({ type: 'text', text: 'replacement' });
  expect(after[3]?.message).toMatchObject({ status: 'completed' });
});

test('finished and stopped Claude replies reach the notification port once each', async () => {
  const terminal: string[] = [];
  installHarnessNotificationPort({ notifyPermissionRequired: () => {},
    notifyTerminalMessage: (message, sessionId) => { terminal.push(`${sessionId}:${message.status}`); } });
  try {
    const f = fixture();
    await f.exec.sendMessage(f.wire, 'origin', 'session', 'first');
    f.stopTurn();
    await f.exec.sendMessage(f.wire, 'origin', 'session', 'second');
    // The notification policy drops `interrupted`; the harness reports every terminal reply.
    expect(terminal).toEqual(['session:completed', 'session:interrupted']);
  } finally {
    installHarnessNotificationPort({ notifyTerminalMessage: () => {}, notifyPermissionRequired: () => {} });
  }
});
