import { beforeEach, afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { Paths } from '@/infrastructure/runtime/paths';
import { createSession, getSession, selectEmptySessionHarnessModel } from '@/infrastructure/sqlite/session-store';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { createClaudeExecution } from '@/harnesses/claude-cli/execution';
import { saveClaudeModelSelection } from '@/harnesses/claude-cli/models';
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(process.cwd(), '.claude-images-test-'));
  mkdirSync(join(dataDir, 'tools'));
  Paths.configure({ dataDir });
  setupTestDatabase();
  seedWorkspace({ id: 'ws', path: process.cwd() });
  createSession({ id: 'session', workspaceId: 'ws', title: 'Claude', status: 'active',
    preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'claude-cli' });
  saveClaudeModelSelection('session', { model: 'claude-sonnet-5', effort: 'medium' });
});
afterEach(() => {
  resetTestDatabase();
  Paths.reset();
  rmSync(dataDir, { recursive: true, force: true });
});

function wireFixture() {
  const events: unknown[] = [];
  const wire = {
    actor: { attachOriginToSession: () => {} },
    delivery: {
      send: (_origin: string, value: unknown) => events.push(value),
      broadcastToSession: (_id: string, value: unknown) => events.push(value),
      broadcast: (value: unknown) => events.push(value),
    },
  } as unknown as SessionWirePorts<string>;
  return { wire, events };
}

function fakeTurn(_prompt: string | AsyncIterable<SDKUserMessage>, options: Options, calls: Options[],
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
    'message.created', 'part.created', 'message.created', 'part.created', 'session.updated', 'message.updated',
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

test('persists SDK context occupancy separately from cumulative usage', async () => {
  const { wire } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (_prompt, options) => {
    async function* stream(): AsyncGenerator<SDKMessage> {
      const session_id = options.sessionId ?? options.resume;
      yield { type: 'system', subtype: 'init', session_id } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id, result: 'done' } as SDKMessage;
    }
    return Object.assign(stream(), { getContextUsage: async () => ({ totalTokens: 50000, rawMaxTokens: 200000 }) });
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'inspect');
  expect(getSession('session')?.metadata?.claudeContext).toEqual({ used: 50000, window: 200000 });
});

test('post-result SDK notifications do not leave a completed Claude turn pending', async () => {
  const { wire } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (_prompt, options) => {
    async function* stream(): AsyncGenerator<SDKMessage> {
      const session_id = options.sessionId ?? options.resume;
      yield { type: 'system', subtype: 'init', session_id } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id, is_error: false, result: 'done' } as SDKMessage;
      yield { type: 'system', subtype: 'task_notification', session_id } as SDKMessage;
      yield { type: 'assistant', session_id, parent_tool_use_id: null,
        message: { content: [{ type: 'text', text: 'late content' }] } } as SDKMessage;
    }
    return stream();
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'inspect');
  expect(listMessagesWithParts('session')[1]?.message).toMatchObject({ status: 'completed' });
  expect(getDatabase().query<{ pending: number }, []>('SELECT pending FROM claude_session_bindings').get()?.pending).toBe(0);
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
test.each([false, true])('Agent child and nested tool transcripts persist when child fails: %s', async (failed) => {
  const { wire, events } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (_prompt, options) => {
    const id = options.sessionId!;
    async function* stream(): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      yield { type: 'assistant', session_id: id, parent_tool_use_id: null, message: {
        content: [{ type: 'tool_use', name: 'Agent', id: 'agent-1', input: { prompt: 'inspect' } }],
      } } as SDKMessage;
      yield { type: 'stream_event', session_id: id, parent_tool_use_id: 'agent-1',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'child' } } } as SDKMessage;
      yield { type: 'assistant', session_id: id, parent_tool_use_id: 'agent-1', message: {
        content: [{ type: 'text', text: 'child text' },
          { type: 'tool_use', name: 'Read', id: 'child-read', input: { file_path: 'README.md' } }],
      } } as SDKMessage;
      yield { type: 'user', session_id: id, parent_tool_use_id: 'agent-1', message: {
        content: [{ type: 'tool_result', tool_use_id: 'child-read', content: 'contents' }],
      } } as SDKMessage;
      yield { type: 'user', session_id: id, parent_tool_use_id: null, message: {
        content: [{ type: 'tool_result', tool_use_id: 'agent-1', content: 'summary', is_error: failed }],
      } } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id: id, is_error: false, result: 'parent reply' } as SDKMessage;
    }
    return stream();
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'inspect');
  const parent = listMessagesWithParts('session')[1]!;
  expect(parent.parts).toHaveLength(2);
  expect(parent.parts.find(part => part.type === 'text')).toMatchObject({ text: 'parent reply' });
  const agent = parent.parts.find(part => part.type === 'tool')!;
  const status = failed ? 'error' : 'completed';
  expect(agent).toMatchObject({ name: 'Claude Agent', state: { status } });
  const childId = (agent.state as { childSessionId: string }).childSessionId;
  expect(childId).toBeTruthy();
  expect(getSession(childId)).toMatchObject({ parentId: 'session', harness: 'claude-cli', subagentStatus: status });
  expect(listMessagesWithParts(childId)[0]).toMatchObject({ message: { status },
    parts: expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'child text' }),
      expect.objectContaining({ type: 'tool', name: 'Claude Read', state: expect.objectContaining({ status: 'completed' }) })]) });
  expect(events.some(event => (event as { type: string }).type === 'session.created')).toBe(true);
});
test('child keeps working after parent result and finishes on native task notification', async () => {
  const { wire } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (_prompt, options) => {
    const id = options.sessionId!;
    async function* stream(): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      yield { type: 'assistant', session_id: id, parent_tool_use_id: null, message: {
        content: [{ type: 'tool_use', name: 'Agent', id: 'agent-1', input: { prompt: 'inspect' } }],
      } } as SDKMessage;
      yield { type: 'system', subtype: 'task_started', task_type: 'local_agent', task_id: 'task-1',
        tool_use_id: 'agent-1', is_backgrounded: false, session_id: id } as SDKMessage;
      yield { type: 'system', subtype: 'task_updated', task_id: 'task-1',
        patch: { is_backgrounded: true }, session_id: id } as SDKMessage;
      yield { type: 'user', session_id: id, parent_tool_use_id: null, message: {
        content: [{ type: 'tool_result', tool_use_id: 'agent-1', content: 'running in background' }],
      } } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id: id, is_error: false, result: 'parent done' } as SDKMessage;
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      yield { type: 'assistant', session_id: id, parent_tool_use_id: 'agent-1', message: {
        content: [{ type: 'text', text: 'child worked after result' }],
      } } as SDKMessage;
      yield { type: 'system', subtype: 'task_notification', session_id: id,
        task_id: 'task-1', status: 'completed' } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id: id, is_error: false,
        result: 'background followup' } as SDKMessage;
    }
    return stream();
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'inspect');
  const parent = listMessagesWithParts('session')[1]!;
  expect(parent.message).toMatchObject({ status: 'completed' });
  expect(parent.parts.find(part => part.type === 'text')).toMatchObject({ text: 'parent done' });
  const agent = parent.parts.find(part => part.type === 'tool')!;
  const childId = (agent.state as { childSessionId: string }).childSessionId;
  expect(getSession(childId)).toMatchObject({ subagentStatus: 'completed' });
  expect(listMessagesWithParts(childId)[0]?.parts).toContainEqual(expect.objectContaining({ text: 'child worked after result' }));
  expect(getDatabase().query<{ pending: number }, []>('SELECT pending FROM claude_session_bindings').get()?.pending).toBe(0);
});

test('validated image sends an SDK image block and persists a reloadable image part', async () => {
  const { createAttachment } = await import('@/infrastructure/sqlite/attachments');
  const image = createAttachment({ sessionId: 'session', workspaceId: 'ws', filename: 'photo.png',
    mimeType: 'image/png', sizeBytes: 4, data: new Uint8Array([137, 80, 78, 71]).buffer });
  const prompts: SDKUserMessage[] = [];
  const { wire } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (prompt, options) => {
    async function* stream(): AsyncGenerator<SDKMessage> {
      if (typeof prompt !== 'string') {
        const first = await prompt[Symbol.asyncIterator]().next();
        if (!first.done) prompts.push(first.value);
      }
      const id = options.sessionId ?? options.resume;
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id: id, is_error: false, result: 'seen' } as SDKMessage;
    }
    return stream();
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'describe', [{ id: image.id, kind: 'image' }]);
  expect(prompts[0]?.message.content).toEqual([
    { type: 'text', text: 'describe' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw==' } },
  ]);
  expect(listMessagesWithParts('session')[0]?.parts).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'image', mimeType: 'image/png' }),
  ]));
  expect(getDatabase().query<{ pending: number }, []>('SELECT pending FROM claude_session_bindings').get()?.pending).toBe(0);
});

test('invalid image is rejected before creating a native binding or sending a prompt', async () => {
  const { wire, events } = wireFixture();
  let calls = 0;
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (prompt, options) => {
    calls++;
    return fakeTurn(prompt, options, []);
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'describe', [{ id: 'missing', kind: 'image' }]);
  expect(calls).toBe(0);
  expect(listMessagesWithParts('session')).toEqual([]);
  expect(getDatabase().query('SELECT 1 FROM claude_session_bindings').get()).toBeNull();
  expect(events).toEqual([expect.objectContaining({ type: 'error' })]);
});

test('model usage includes child costs, persists totals and rejects missing usage as unknown', async () => {
  const { wire } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (_prompt, options) => {
    const id = options.sessionId ?? options.resume;
    async function* stream(): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id: id, is_error: false, result: 'done', modelUsage: {
        'claude-sonnet-5': { inputTokens: 10, outputTokens: 3, cacheReadInputTokens: 5,
          cacheCreationInputTokens: 2, contextWindow: 200000, costUSD: 0.01 },
        'claude-opus-5': { inputTokens: 7, outputTokens: 4, cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0, contextWindow: 100000, costUSD: 0.02 },
      } } as unknown as SDKMessage;
    }
    return stream();
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'hello');
  expect(listMessagesWithParts('session')[1]?.message).toMatchObject({ tokens: { prompt: 24, completion: 7 }, cost: 0.03 });
  expect(getSession('session')).toMatchObject({ promptTokens: 24, completionTokens: 7, totalTokens: 31,
    metadata: { claudeUsage: { contextWindow: 200000 } } });
});
test('records only native compaction boundaries, not a fabricated manual compact turn', async () => {
  const { wire, events } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (_prompt, options) => {
    const id = options.sessionId ?? options.resume;
    async function* stream(): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      yield { type: 'system', subtype: 'compact_boundary', session_id: id,
        compact_metadata: { trigger: 'auto', pre_tokens: 150000, post_tokens: 30000 } } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id: id, is_error: false, result: 'done' } as SDKMessage;
    }
    return stream();
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'hello');
  expect(getSession('session')?.metadata).toMatchObject({ claudeCompaction: {
    trigger: 'auto', preTokens: 150000, postTokens: 30000 } });
  expect(events.some(event => (event as { type?: string }).type === 'session.updated')).toBe(true);
});
test('early child events attach only to their Agent, and Stop closes the child transcript', async () => {
  const { wire } = wireFixture();
  let childStarted!: () => void;
  const ready = new Promise<void>(resolve => { childStarted = resolve; });
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (_prompt, options) => {
    const id = options.sessionId!;
    async function* stream(): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      yield { type: 'assistant', session_id: id, parent_tool_use_id: 'agent-1', message: {
        content: [{ type: 'text', text: 'early child' }],
      } } as SDKMessage;
      yield { type: 'assistant', session_id: id, parent_tool_use_id: 'orphan', message: {
        content: [{ type: 'text', text: 'orphan child' }],
      } } as SDKMessage;
      yield { type: 'assistant', session_id: id, parent_tool_use_id: null, message: {
        content: [{ type: 'tool_use', name: 'Agent', id: 'agent-1', input: { prompt: 'inspect' } }],
      } } as SDKMessage;
      childStarted();
      await new Promise<void>(resolve => options.abortController!.signal.addEventListener('abort', () => resolve(), { once: true }));
      throw new Error('Interrupted');
    }
    return stream();
  } });
  const turn = exec.sendMessage(wire, 'origin', 'session', 'inspect');
  await ready;
  await exec.interruptSession('session');
  await turn;
  const parent = listMessagesWithParts('session')[1]!;
  expect(parent.parts).toHaveLength(1);
  const part = parent.parts[0]!;
  if (part.type !== 'tool' || !('childSessionId' in part.state)) throw new Error('Missing Agent child');
  const childId = part.state.childSessionId!;
  expect(getSession(childId)?.subagentStatus).toBe('interrupted');
  expect(listMessagesWithParts(childId)[0]).toMatchObject({ message: { status: 'interrupted' },
    parts: [{ type: 'text', text: 'early child' }] });
});
