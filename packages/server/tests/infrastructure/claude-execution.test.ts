import { beforeEach, afterEach, expect, test } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession, selectEmptySessionHarnessModel } from '@/infrastructure/sqlite/session-store';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { createClaudeExecution } from '@/harnesses/claude-cli/execution';
import { saveClaudeModelSelection } from '@/harnesses/claude-cli/models';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';

beforeEach(() => {
  setupTestDatabase();
  seedWorkspace({ id: 'ws', path: process.cwd() });
  createSession({ id: 'session', workspaceId: 'ws', title: 'Claude', status: 'active',
    preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'claude-cli' });
  saveClaudeModelSelection('session', { model: 'claude-sonnet-5', effort: 'medium' });
});
afterEach(resetTestDatabase);

function wireFixture() {
  const events: unknown[] = [];
  const wire = {
    actor: { attachOriginToSession: () => {} },
    delivery: {
      send: (_origin: string, value: unknown) => events.push(value),
      broadcastToSession: (_id: string, value: unknown) => events.push(value),
    },
  } as unknown as SessionWirePorts<string>;
  return { wire, events };
}

function fakeTurn(_prompt: string, options: Options, calls: Options[],
  outcome: 'success' | 'failure' = 'success'): AsyncIterable<SDKMessage> {
  calls.push(options);
  const id = options.sessionId ?? options.resume;
  async function* messages(): AsyncGenerator<SDKMessage> {
    yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
    yield { type: 'assistant', session_id: id, parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: 'reply' }] } } as SDKMessage;
    yield { type: 'result', subtype: outcome, session_id: id,
      is_error: outcome !== 'success', result: 'reply' } as SDKMessage;
  }
  return messages();
}

test('selected Claude model and effort deliver a persisted reply through the fake CLI', async () => {
  const initial = createSession({ id: 'from-picker', workspaceId: 'ws', title: 'Empty', status: 'active',
    preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'prokop' });
  const choice = { harness: 'claude-cli', modelId: 'claude-opus-5', effort: 'low' } as const;
  const selected = selectEmptySessionHarnessModel(initial.id, 'prokop', initial.updatedAt, choice);
  expect(selected).toMatchObject({ harness: 'claude-cli', selectedModel: 'claude-opus-5' });
  const calls: Options[] = [];
  const { wire, events } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.274',
    start: (prompt, options) => fakeTurn(prompt, options, calls) });
  await exec.sendMessage(wire, 'origin', initial.id, 'hello Claude');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ model: 'claude-opus-5', effort: 'low', persistSession: true,
    permissionMode: 'default', permissionPrompts: 'host', allowedTools: [] });
  expect(calls[0]?.hooks?.PreToolUse).toHaveLength(1);
  expect(events.map(event => (event as { type: string }).type)).toEqual([
    'message.created', 'part.created', 'message.created', 'part.created', 'message.updated',
  ]);
  expect(listMessagesWithParts(initial.id)).toMatchObject([
    { message: { role: 'user' }, parts: [{ type: 'text', text: 'hello Claude' }] },
    { message: { role: 'assistant', modelId: 'claude-opus-5', status: 'completed' },
      parts: [{ type: 'text', text: 'reply' }] },
  ]);
  expect(getDatabase().query<{ pending: number }, [string]>(
    'SELECT pending FROM claude_session_bindings WHERE session_id = ?',
  ).get(initial.id)?.pending).toBe(0);
});

test('persists and resumes native CLI identity, model and effort over two text turns', async () => {
  const calls: Options[] = [];
  const { wire, events } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.274',
    start: (prompt, options) => fakeTurn(prompt, options, calls) });
  await exec.sendMessage(wire, 'origin', 'session', 'first');
  await exec.sendMessage(wire, 'origin', 'session', 'second');
  const messages = listMessagesWithParts('session');
  expect(messages.map(entry => entry.message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  expect(messages[1]?.parts[0]).toMatchObject({ type: 'text', text: 'reply' });
  expect(messages[3]?.message).toMatchObject({ status: 'completed' });
  expect(calls[0]?.sessionId).toBeTruthy();
  expect(calls[1]?.resume).toBe(calls[0]?.sessionId);
  expect(calls[0]).toMatchObject({ model: 'claude-sonnet-5', effort: 'medium', persistSession: true });
  expect(getDatabase().query<{ pending: number }, []>('SELECT pending FROM claude_session_bindings').get()?.pending).toBe(0);
  expect(events.some(event => (event as { type?: string }).type === 'message.updated')).toBe(true);
});

test('persists native tool calls, bounded results, and assistant text', async () => {
  const { wire, events } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (_prompt, options) => {
    const id = options.sessionId!;
    async function* stream(): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      yield { type: 'assistant', session_id: id, parent_tool_use_id: null, message: {
        content: [{ type: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: 'README.md' } },
          { type: 'text', text: 'Here is the file' }],
      } } as SDKMessage;
      yield { type: 'user', session_id: id, parent_tool_use_id: null, message: {
        content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'file contents' }],
      } } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id: id, is_error: false, result: 'Here is the file' } as SDKMessage;
    }
    return stream();
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'read the file');
  const assistant = listMessagesWithParts('session')[1];
  expect(assistant?.message).toMatchObject({ status: 'completed' });
  expect(assistant?.parts).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'tool', name: 'Claude Read', state: expect.objectContaining({ status: 'completed' }) }),
    expect.objectContaining({ type: 'text', text: 'Here is the file' }),
  ]));
  expect(events.some(event => (event as { type?: string }).type === 'part.updated')).toBe(true);
});

test('streams text before completion and reconciles the complete message without duplicate parts', async () => {
  const { wire, events } = wireFixture();
  let resume!: () => void;
  let streamed!: () => void;
  const continueTurn = new Promise<void>(resolve => { resume = resolve; });
  const partialReceived = new Promise<void>(resolve => { streamed = resolve; });
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (_prompt, options) => {
    const id = options.sessionId!;
    async function* stream(): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      yield { type: 'stream_event', session_id: id, parent_tool_use_id: null,
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } } as SDKMessage;
      yield { type: 'stream_event', session_id: id, parent_tool_use_id: null,
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } } } as SDKMessage;
      streamed();
      await continueTurn;
      yield { type: 'assistant', session_id: id, parent_tool_use_id: null,
        message: { content: [{ type: 'text', text: 'Hello!' }] } } as SDKMessage;
      yield { type: 'assistant', session_id: id, parent_tool_use_id: null,
        message: { content: [{ type: 'text', text: ' Bye.' }] } } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id: id, is_error: false,
        result: ' Bye.' } as SDKMessage;
    }
    return stream();
  } });
  const turn = exec.sendMessage(wire, 'origin', 'session', 'hello');
  await partialReceived;
  // The stream has been yielded through the async generator before its next await.
  expect(listMessagesWithParts('session')[1]?.parts).toMatchObject([{ type: 'text', text: 'Hello' }]);
  expect(events.filter(event => (event as { type?: string }).type === 'part.append')).toHaveLength(2);
  resume();
  await turn;
  expect(listMessagesWithParts('session')[1]?.parts).toMatchObject([{ type: 'text', text: 'Hello! Bye.' }]);
  expect(events.filter(event => (event as { type?: string }).type === 'part.created')).toHaveLength(2);
  expect(events.filter(event => (event as { type?: string }).type === 'part.updated')).toHaveLength(2);
});

test('Stop retains already streamed text without a duplicate part', async () => {
  const { wire, events } = wireFixture();
  let started!: () => void;
  const partialReceived = new Promise<void>(resolve => { started = resolve; });
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (_prompt, options) => {
    const id = options.sessionId!;
    async function* stream(): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      yield { type: 'stream_event', session_id: id, parent_tool_use_id: null,
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Partial' } } } as SDKMessage;
      started();
      await new Promise<void>(resolve => options.abortController!.signal.addEventListener('abort', () => resolve(), { once: true }));
      throw new Error('Claude turn interrupted');
    }
    return stream();
  } });
  const turn = exec.sendMessage(wire, 'origin', 'session', 'hello');
  await partialReceived;
  await exec.interruptSession('session');
  await turn;
  expect(listMessagesWithParts('session')[1]).toMatchObject({
    message: { status: 'interrupted' }, parts: [{ type: 'text', text: 'Partial' }],
  });
  expect(events.filter(event => (event as { type?: string }).type === 'part.created')).toHaveLength(2);
  expect(events.filter(event => (event as { type?: string }).type === 'error')).toHaveLength(0);
});

test('Stop interrupts the tool row without sending a Claude turn error to the origin', async () => {
  const { wire, events } = wireFixture();
  let signal: AbortSignal | undefined;
  let started!: () => void;
  const toolStarted = new Promise<void>(resolve => { started = resolve; });
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (_prompt, options) => {
    signal = options.abortController?.signal;
    const id = options.sessionId!;
    async function* stream(): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      yield { type: 'assistant', session_id: id, parent_tool_use_id: null, message: {
        content: [{ type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'pwd' } }],
      } } as SDKMessage;
      started();
      await new Promise<void>(resolve => signal!.addEventListener('abort', () => resolve(), { once: true }));
      throw new Error('Claude turn interrupted');
    }
    return stream();
  } });
  const turn = exec.sendMessage(wire, 'origin', 'session', 'check repo');
  await toolStarted;
  expect(await exec.interruptSession('session')).toMatchObject({ success: true });
  await turn;
  expect(events.filter(event => (event as { type?: string }).type === 'error')).toEqual([]);
  expect(listMessagesWithParts('session')[1]).toMatchObject({
    message: { status: 'interrupted' },
    parts: [expect.objectContaining({ type: 'tool', state: expect.objectContaining({ status: 'interrupted' }) })],
  });
  expect(getDatabase().query<{ pending: number }, []>('SELECT pending FROM claude_session_bindings').get()?.pending).toBe(1);
});

test('failed turns retain partial text without replaying it', async () => {
  const { wire, events } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (_prompt, options) => {
    const id = options.sessionId!;
    async function* stream(): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      yield { type: 'stream_event', session_id: id, parent_tool_use_id: null,
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Partial' } } } as SDKMessage;
      yield { type: 'result', subtype: 'error_during_execution', session_id: id, is_error: true } as SDKMessage;
    }
    return stream();
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'hello');
  expect(listMessagesWithParts('session')[1]).toMatchObject({
    message: { status: 'error' }, parts: [{ type: 'text', text: 'Partial' }],
  });
  expect(events.filter(event => (event as { type?: string }).type === 'part.created')).toHaveLength(2);
  expect(getDatabase().query<{ pending: number }, []>('SELECT pending FROM claude_session_bindings').get()?.pending).toBe(1);
});

test('retains received text on failed turns without replaying the pending turn', async () => {
  const calls: Options[] = [];
  const { wire, events } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.274',
    start: (prompt, options) => fakeTurn(prompt, options, calls, 'failure') });
  await exec.sendMessage(wire, 'origin', 'session', 'first');
  await exec.sendMessage(wire, 'origin', 'session', 'second');
  expect(calls).toHaveLength(1);
  expect(listMessagesWithParts('session')[1]).toMatchObject({
    message: { status: 'error' }, parts: [{ type: 'text', text: 'reply' }],
  });
  expect(events.some(event => typeof (event as { message?: unknown }).message === 'string'
    && (event as { message: string }).message.includes('reconciliation'))).toBe(true);
  expect(getDatabase().query<{ pending: number }, []>('SELECT pending FROM claude_session_bindings').get()?.pending).toBe(1);
});
