import { beforeEach, afterEach, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { Paths } from '@/infrastructure/runtime/paths';
import { createSession, getSession, selectEmptySessionHarnessModel, updateSession } from '@/infrastructure/sqlite/session-store';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { createClaudeExecution } from '@/harnesses/claude-cli/execution';
import { runClaudeCompact } from '@/harnesses/claude-cli/compact';
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

test('a new ordinary Claude turn uses its persisted local user ID as the native prompt ID', async () => {
  const { wire } = wireFixture();
  let nativePromptId: string | undefined;
  const exec = createClaudeExecution({ version: () => '2.1.274', start: (prompt, options) => {
    async function* stream(): AsyncGenerator<SDKMessage> {
      expect(typeof prompt).not.toBe('string');
      const message = (await (prompt as AsyncIterable<SDKUserMessage>)[Symbol.asyncIterator]().next()).value;
      nativePromptId = message?.uuid;
      const session_id = options.sessionId ?? options.resume;
      yield { type: 'system', subtype: 'init', session_id } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id, result: 'done' } as SDKMessage;
    }
    return stream();
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'hello Claude');
  expect(nativePromptId).toBe(listMessagesWithParts('session')[0]?.message.id);
});

test('Claude Goal uses native transcript verdict to complete and then permits ordinary chat', async () => {
  const { wire } = wireFixture();
  const calls: Options[] = [];
  const exec = createClaudeExecution({ version: () => '2.1.274',
    start: (prompt, options) => fakeTurn(prompt, options, calls),
    readGoalVerdict: async () => 2 });
  await exec.sendMessage(wire, 'origin', 'session', 'tests pass', undefined, undefined, 'tests pass');
  expect(getSession('session')?.metadata?.claudeGoal).toEqual({ condition: 'tests pass', status: 'ended', iterations: 2 });
  expect(getDatabase().query<{ pending: number }, []>('SELECT pending FROM claude_session_bindings').get()?.pending).toBe(0);
  expect(listMessagesWithParts('session')[1]?.message).toMatchObject({ status: 'completed' });
  await exec.sendMessage(wire, 'origin', 'session', 'ordinary chat');
  expect(calls).toHaveLength(2);
});

test.each([false, true])('Claude Goal without a native verdict remains locked despite SDK clear: %s', async sdkClear => {
  const { wire, events } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.274',
    start: (_prompt, options) => {
      const id = options.sessionId!;
      async function* stream(): AsyncGenerator<SDKMessage> {
        yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
        if (sdkClear) {
          yield { type: 'active_goal', session_id: id, value: { condition: 'tests pass', iterations: 1 } } as unknown as SDKMessage;
          yield { type: 'active_goal', session_id: id, value: null } as unknown as SDKMessage;
        }
        yield { type: 'result', subtype: 'success', session_id: id, result: 'done' } as SDKMessage;
      }
      return stream();
    }, readGoalVerdict: async () => {
      if (sdkClear) expect(getSession('session')?.metadata?.claudeGoal).toMatchObject({ status: 'active', iterations: 1 });
      return null;
    } });
  await exec.sendMessage(wire, 'origin', 'session', 'tests pass', undefined, undefined, 'tests pass');
  expect(getSession('session')?.metadata?.claudeGoal).toMatchObject({ status: 'uncertain' });
  expect(events).toContainEqual(expect.objectContaining({ type: 'error', message: 'Claude goal outcome is uncertain' }));
  expect(getDatabase().query<{ pending: number }, []>('SELECT pending FROM claude_session_bindings').get()?.pending).toBe(1);
});

test.each(['active', 'uncertain'] as const)(
  'previously %s Claude Goal remains locked across a new executor', async status => {
    updateSession('session', { metadata: { claudeGoal: { condition: 'tests pass', status, iterations: 0 } } });
    getDatabase().run(`INSERT INTO claude_session_bindings
      (session_id, native_session_id, workspace_root, cli_version, pending) VALUES (?, ?, ?, ?, 1)`,
    ['session', crypto.randomUUID(), process.cwd(), '2.1.274']);
    const { wire, events } = wireFixture();
    const exec = createClaudeExecution({ version: () => '2.1.274', start: () => { throw new Error('must not launch'); } });
    await exec.sendMessage(wire, 'origin', 'session', 'retry');
    await exec.sendMessage(wire, 'origin', 'session', 'tests pass', undefined, undefined, 'tests pass');
    expect(events).toEqual(Array.from({ length: 2 }, () => ({ type: 'error', code: 'invalid_session',
      sessionId: 'session', message: 'Claude goal requires reconciliation; do not send in this session' })));
    expect((await exec.compact('session', 'manual', wire.delivery)).ok).toBe(false);
    expect(getSession('session')?.metadata?.claudeGoal).toMatchObject({ status });
    expect(getDatabase().query<{ pending: number }, []>('SELECT pending FROM claude_session_bindings').get()?.pending).toBe(1);
    expect(listMessagesWithParts('session')).toHaveLength(0);
  },
);

test('rejects malformed Claude Goal inputs before creating a native binding', async () => {
  const { wire, events } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.274', start: () => { throw new Error('must not launch'); } });
  await exec.sendMessage(wire, 'origin', 'session', 'tests pass', undefined, undefined, 'different');
  await exec.sendMessage(wire, 'origin', 'session', 'tests pass', undefined, undefined, 'tests pass', 4);
  await exec.sendMessage(wire, 'origin', 'session', 'a\nb', undefined, undefined, 'a\nb');
  expect(events).toHaveLength(3);
  expect(getDatabase().query('SELECT session_id FROM claude_session_bindings').all()).toHaveLength(0);
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
    expect.objectContaining({ type: 'tool', name: 'read-file', state: expect.objectContaining({ status: 'completed' }) }),
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
  expect(agent).toMatchObject({ name: 'subagent', state: { status } });
  const childId = (agent.state as { childSessionId: string }).childSessionId;
  expect(childId).toBeTruthy();
  expect(getSession(childId)).toMatchObject({ parentId: 'session', harness: 'claude-cli', subagentStatus: status });
  expect(listMessagesWithParts(childId)[0]).toMatchObject({ message: { status },
    parts: expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'child text' }),
      expect.objectContaining({ type: 'tool', name: 'read-file', state: expect.objectContaining({ status: 'completed' }) })]) });
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
test('manual Claude compaction uses the SDK command, waits for its boundary and never saves a chat turn', async () => {
  const { wire, events } = wireFixture();
  const calls: Array<string | AsyncIterable<SDKUserMessage>> = [];
  const exec = createClaudeExecution({ version: () => '2.1.278', start: (prompt, options) => {
    calls.push(prompt);
    const id = options.sessionId ?? options.resume;
    async function* stream(): AsyncGenerator<SDKMessage> {
      if (typeof prompt === 'string') yield { type: 'system', subtype: 'status', status: 'compacting',
        session_id: id } as SDKMessage;
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      if (typeof prompt === 'string') {
        expect(prompt).toBe('/compact');
        expect(options.resume).toBe(id);
        yield { type: 'system', subtype: 'compact_boundary', session_id: id,
          compact_metadata: { trigger: 'manual', pre_tokens: 10000, post_tokens: 3000 } } as SDKMessage;
        yield { type: 'result', subtype: 'success', session_id: id, result: '' } as SDKMessage;
      } else yield { type: 'result', subtype: 'success', session_id: id, result: 'hello' } as SDKMessage;
    }
    return stream();
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'hello');
  const before = listMessagesWithParts('session');
  const outcome = await exec.compact('session', 'manual', wire.delivery);
  expect(outcome).toMatchObject({ ok: true });
  expect(calls).toHaveLength(2);
  expect(listMessagesWithParts('session')).toEqual(before);
  expect(getSession('session')?.metadata).toMatchObject({ claudeCompaction: {
    trigger: 'manual', preTokens: 10000, postTokens: 3000 },
    claudeCompactedAfterMessageId: before.at(-1)?.message.id });
  expect(getSession('session')?.metadata?.claudeCompactPending).toBeUndefined();
  expect(events.some(event => (event as { type?: string }).type === 'session.updated')).toBe(true);
});

test('compact with no native boundary is not reported as completed', async () => {
  const { wire } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.278', start: (prompt, options) => {
    const id = options.sessionId ?? options.resume;
    async function* stream(): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id: id,
        result: typeof prompt === 'string' ? 'Not enough messages to compact.' : 'hello' } as SDKMessage;
    }
    return stream();
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'hello');
  expect(await exec.compact('session', 'manual', wire.delivery)).toMatchObject({ ok: false, skipped: true });
  expect(getSession('session')?.metadata?.claudeCompactPending).toBeUndefined();
  expect(getSession('session')?.metadata?.claudeCompactedAt).toBeUndefined();
});

test('failed compact result with no boundary settles without claiming success', async () => {
  const { wire } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.278', start: (prompt, options) => {
    const id = options.sessionId ?? options.resume;
    async function* stream(): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      yield { type: 'result', subtype: typeof prompt === 'string' ? 'error_during_execution' : 'success',
        is_error: typeof prompt === 'string', session_id: id, result: 'done' } as SDKMessage;
      if (typeof prompt === 'string') throw new Error('SDK throws after error result');
    }
    return stream();
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'hello');
  expect(await exec.compact('session', 'manual', wire.delivery)).toMatchObject({ ok: false, skipped: true });
  expect(getSession('session')?.metadata?.claudeCompactPending).toBeUndefined();
});

test.each(['failed-after-boundary', 'wrong-session', 'boundary-after-result'] as const)(
  'uncertain compact stream %s blocks retry', async (scenario) => {
    const { wire } = wireFixture();
    const exec = createClaudeExecution({ version: () => '2.1.278', start: (prompt, options) => {
      const id = options.sessionId ?? options.resume;
      async function* stream(): AsyncGenerator<SDKMessage> {
        yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
        if (typeof prompt === 'string') {
          if (scenario === 'wrong-session') {
            yield { type: 'system', subtype: 'compact_boundary', session_id: 'other',
              compact_metadata: { trigger: 'manual', pre_tokens: 10000 } } as SDKMessage;
          } else {
            if (scenario === 'failed-after-boundary') yield { type: 'system', subtype: 'compact_boundary', session_id: id,
              compact_metadata: { trigger: 'manual', pre_tokens: 10000 } } as SDKMessage;
            yield { type: 'result', subtype: scenario === 'failed-after-boundary' ? 'error_during_execution' : 'success',
              is_error: scenario === 'failed-after-boundary', session_id: id } as SDKMessage;
            if (scenario === 'boundary-after-result') yield { type: 'system', subtype: 'compact_boundary', session_id: id,
              compact_metadata: { trigger: 'manual', pre_tokens: 10000 } } as SDKMessage;
          }
        } else yield { type: 'result', subtype: 'success', session_id: id, result: 'hello' } as SDKMessage;
      }
      return stream();
    } });
    await exec.sendMessage(wire, 'origin', 'session', 'hello');
    expect(await exec.compact('session', 'manual', wire.delivery)).toMatchObject({ ok: false });
    expect(getSession('session')?.metadata?.claudeCompactPending).toBe(true);
  },
);

test.each([
  ['status', 'requesting', 'system:status'],
  ['secret_payload_123', undefined, 'system:unknown'],
] as const)(
  'unexpected pre-init compact event %s remains locked and logs only its known subtype', async (subtype, status, label) => {
    const log = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const stream = async function* (): AsyncGenerator<SDKMessage> {
        yield { type: 'system', subtype, status, session_id: 'native', content: 'private text' } as unknown as SDKMessage;
        yield { type: 'system', subtype: 'init', session_id: 'native' } as SDKMessage;
        yield { type: 'result', subtype: 'success', session_id: 'native' } as SDKMessage;
      };
      await expect(runClaudeCompact({ cwd: process.cwd(), nativeId: 'native', model: 'claude-sonnet-5',
        effort: 'medium', controller: new AbortController(), start: () => stream() })).rejects.toThrow();
      expect(log).toHaveBeenCalledWith('[claude-cli] compact stream error', expect.objectContaining({
        initialized: false, lastEvent: label, invalidStream: true, boundarySeen: false,
      }));
      expect(JSON.stringify(log.mock.calls)).not.toContain('private text');
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret_payload_123');
    } finally { log.mockRestore(); }
  },
);

test.each(['assistant', 'user', 'stream_event', 'autocompact_state', 'active_goal',
  'private_type_123'] as const)(
  'unexpected %s event after compacting progress is logged without payload', async type => {
    const log = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const stream = async function* (): AsyncGenerator<SDKMessage> {
        yield { type: 'system', subtype: 'status', status: 'compacting', session_id: 'native' } as SDKMessage;
        yield { type, session_id: 'native', message: 'private text', content: 'private text' } as unknown as SDKMessage;
      };
      await expect(runClaudeCompact({ cwd: process.cwd(), nativeId: 'native', model: 'claude-sonnet-5',
        effort: 'medium', controller: new AbortController(), start: () => stream() })).rejects.toThrow();
      expect(log).toHaveBeenCalledWith('[claude-cli] compact stream error', expect.objectContaining({
        initialized: false, lastEvent: type === 'private_type_123' ? 'unknown' : type,
        lastStatus: 'compacting', invalidStream: true, boundarySeen: false, eventCount: 2,
        recentEvents: [
          { event: 'system:status', session: 'match', status: 'compacting',
            compactResult: 'absent', compactError: false },
          { event: type === 'private_type_123' ? 'unknown' : type, session: 'match' },
        ],
      }));
      expect(JSON.stringify(log.mock.calls)).not.toContain('private text');
      expect(JSON.stringify(log.mock.calls)).not.toContain('private_type_123');
    } finally { log.mockRestore(); }
  },
);

test.each([true, false])('same-session rate-limit telemetry is ignored with init: %s', async withInit => {
  const stream = async function* (): AsyncGenerator<SDKMessage> {
    yield { type: 'system', subtype: 'status', status: 'compacting', session_id: 'native' } as SDKMessage;
    yield { type: 'rate_limit_event', session_id: 'native',
      rate_limit_info: { status: 'allowed_warning' } } as SDKMessage;
    if (withInit) yield { type: 'system', subtype: 'init', session_id: 'native' } as SDKMessage;
    yield { type: 'system', subtype: 'compact_boundary', session_id: 'native',
      compact_metadata: { trigger: 'manual', pre_tokens: 10000, post_tokens: 3000 } } as SDKMessage;
    yield { type: 'rate_limit_event', session_id: 'native', rate_limit_info: { status: 'allowed' } } as SDKMessage;
    yield { type: 'result', subtype: 'success', session_id: 'native' } as SDKMessage;
  };
  expect(await runClaudeCompact({ cwd: process.cwd(), nativeId: 'native', model: 'claude-sonnet-5',
    effort: 'medium', controller: new AbortController(), start: () => stream() })).toEqual({
    confirmed: true, boundary: { preTokens: 10000, postTokens: 3000 },
  });
});

test.each(['no-progress', 'wrong-session', 'too-many', 'after-result', 'no-boundary'] as const)(
  'rate-limit telemetry %s does not bypass compact validation', async scenario => {
    const log = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const stream = async function* (): AsyncGenerator<SDKMessage> {
        if (scenario !== 'no-progress') yield { type: 'system', subtype: 'status', status: 'compacting',
          session_id: 'native' } as SDKMessage;
        const count = scenario === 'too-many' ? 17 : 1;
        for (let i = 0; i < count; i++) yield { type: 'rate_limit_event',
          session_id: scenario === 'wrong-session' ? 'other' : 'native',
          rate_limit_info: { status: 'allowed' } } as SDKMessage;
        if (scenario !== 'no-boundary') yield { type: 'system', subtype: 'compact_boundary', session_id: 'native',
          compact_metadata: { trigger: 'manual', pre_tokens: 10000 } } as SDKMessage;
        yield { type: 'result', subtype: 'success', session_id: 'native' } as SDKMessage;
        if (scenario === 'after-result') yield { type: 'rate_limit_event', session_id: 'native',
          rate_limit_info: { status: 'allowed' } } as SDKMessage;
      };
      await expect(runClaudeCompact({ cwd: process.cwd(), nativeId: 'native', model: 'claude-sonnet-5',
        effort: 'medium', controller: new AbortController(), start: () => stream() })).rejects.toThrow();
    } finally { log.mockRestore(); }
  },
);

test.each([
  { compactResult: undefined, compactError: undefined, label: 'absent', hasError: false },
  { compactResult: 'success', compactError: undefined, label: 'success', hasError: false },
  { compactResult: 'failed', compactError: 'private compact error', label: 'failed', hasError: true },
  { compactResult: 'private compact error', compactError: undefined, label: 'unknown', hasError: false },
] as const)('pre-init idle status with compact_result $label remains locked and logs only safe fields',
  async ({ compactResult, compactError, label, hasError }) => {
    const log = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const stream = async function* (): AsyncGenerator<SDKMessage> {
        yield { type: 'system', subtype: 'status', status: 'compacting', session_id: 'native' } as SDKMessage;
        yield { type: 'rate_limit_event', session_id: 'native',
          rate_limit_info: { status: 'allowed' } } as SDKMessage;
        yield { type: 'system', subtype: 'status', status: null, session_id: 'native',
          compact_result: compactResult, compact_error: compactError } as SDKMessage;
      };
      await expect(runClaudeCompact({ cwd: process.cwd(), nativeId: 'native', model: 'claude-sonnet-5',
        effort: 'medium', controller: new AbortController(), start: () => stream() })).rejects.toThrow();
      const invalidStream = label !== 'absent' && label !== 'success';
      expect(log).toHaveBeenCalledWith(invalidStream
        ? '[claude-cli] compact stream error' : '[claude-cli] compact stream incomplete', expect.objectContaining({
        initialized: false, lastEvent: 'system:status', lastStatus: 'idle',
        boundarySeen: false, terminalResult: null, eventCount: 3,
        ...(invalidStream ? { invalidStream: true } : {}),
        recentEvents: [
          { event: 'system:status', session: 'match', status: 'compacting',
            compactResult: 'absent', compactError: false },
          { event: 'rate_limit_event', session: 'match' },
          { event: 'system:status', session: 'match', status: 'idle',
            compactResult: label, compactError: hasError },
        ],
      }));
      expect(JSON.stringify(log.mock.calls)).not.toContain('private compact error');
      expect(JSON.stringify(log.mock.calls)).not.toContain('native');
    } finally { log.mockRestore(); }
  },
);

test.each([
  { withInit: false, compactResult: undefined },
  { withInit: true, compactResult: 'success' },
] as const)('idle status before init can precede a confirmed manual boundary: $withInit / $compactResult',
  async ({ withInit, compactResult }) => {
    const stream = async function* (): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'status', status: 'compacting', session_id: 'native' } as SDKMessage;
      yield { type: 'rate_limit_event', session_id: 'native',
        rate_limit_info: { status: 'allowed' } } as SDKMessage;
      yield { type: 'system', subtype: 'status', status: null, session_id: 'native',
        compact_result: compactResult } as SDKMessage;
      if (withInit) yield { type: 'system', subtype: 'init', session_id: 'native' } as SDKMessage;
      yield { type: 'system', subtype: 'compact_boundary', session_id: 'native',
        compact_metadata: { trigger: 'manual', pre_tokens: 10000, post_tokens: 3000 } } as SDKMessage;
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 'native' } as SDKMessage;
    };
    expect(await runClaudeCompact({ cwd: process.cwd(), nativeId: 'native', model: 'claude-sonnet-5',
      effort: 'medium', controller: new AbortController(), start: () => stream() })).toEqual({
      confirmed: true, boundary: { preTokens: 10000, postTokens: 3000 },
    });
  },
);

test.each([
  { name: 'without progress', events: [{ status: null }] },
  { name: 'with an error', events: [{ status: 'compacting' },
    { status: null, compact_result: 'success', compact_error: 'private error' }] },
  { name: 'past the status limit', events: [{ status: 'compacting' },
    ...Array.from({ length: 8 }, () => ({ status: null }))] },
] as const)('pre-init idle status $name cannot bypass validation', async ({ events }) => {
  const log = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const stream = async function* (): AsyncGenerator<SDKMessage> {
      for (const event of events) yield { type: 'system', subtype: 'status',
        session_id: 'native', ...event } as SDKMessage;
      yield { type: 'system', subtype: 'compact_boundary', session_id: 'native',
        compact_metadata: { trigger: 'manual', pre_tokens: 10000 } } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id: 'native' } as SDKMessage;
    };
    await expect(runClaudeCompact({ cwd: process.cwd(), nativeId: 'native', model: 'claude-sonnet-5',
      effort: 'medium', controller: new AbortController(), start: () => stream() })).rejects.toThrow();
    expect(log).toHaveBeenCalledWith('[claude-cli] compact stream error', expect.objectContaining({
      invalidStream: true, boundarySeen: false,
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('private error');
  } finally { log.mockRestore(); }
});

test('compact diagnostic keeps only twelve event discriminants, not native IDs or content', async () => {
  const log = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const stream = async function* (): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: 'native' } as SDKMessage;
      for (let i = 0; i < 14; i++) yield { type: 'system', subtype: 'status',
        status: 'compacting', session_id: 'native', content: 'private text' } as unknown as SDKMessage;
      yield { type: 'autocompact_state', session_id: 'native', content: 'private text' } as unknown as SDKMessage;
    };
    await expect(runClaudeCompact({ cwd: process.cwd(), nativeId: 'native', model: 'claude-sonnet-5',
      effort: 'medium', controller: new AbortController(), start: () => stream() })).rejects.toThrow();
    expect(log).toHaveBeenCalledWith('[claude-cli] compact stream incomplete', expect.objectContaining({
      eventCount: 16, lastEvent: 'autocompact_state', recentEvents: [
        ...Array.from({ length: 11 }, () => ({ event: 'system:status', session: 'match',
          status: 'compacting', compactResult: 'absent', compactError: false })),
        { event: 'autocompact_state', session: 'match' },
      ],
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('private text');
    expect(JSON.stringify(log.mock.calls)).not.toContain('native');
  } finally { log.mockRestore(); }
});

test.each([
  { name: 'wrong native session', statuses: [{ status: 'compacting', session_id: 'other' }] },
  { name: 'pre-init completion claim', statuses: [{ status: 'compacting', compact_result: 'success' }] },
  { name: 'pre-init failure', statuses: [{ status: 'compacting', compact_result: 'failed' }] },
  { name: 'too many progress events', statuses: Array.from({ length: 9 }, () => ({ status: 'compacting' })) },
] as const)('compact rejects $name without reporting completion', async ({ statuses }) => {
  const log = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const stream = async function* (): AsyncGenerator<SDKMessage> {
      for (const status of statuses) yield { type: 'system', subtype: 'status', session_id: 'native',
        ...status } as SDKMessage;
      yield { type: 'system', subtype: 'init', session_id: 'native' } as SDKMessage;
      yield { type: 'system', subtype: 'compact_boundary', session_id: 'native',
        compact_metadata: { trigger: 'manual', pre_tokens: 10000 } } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id: 'native' } as SDKMessage;
    };
    await expect(runClaudeCompact({ cwd: process.cwd(), nativeId: 'native', model: 'claude-sonnet-5',
      effort: 'medium', controller: new AbortController(), start: () => stream() })).rejects.toThrow();
  } finally { log.mockRestore(); }
});

test('local slash compact can confirm from progress, manual boundary and result without init', async () => {
  const stream = async function* (): AsyncGenerator<SDKMessage> {
    yield { type: 'system', subtype: 'status', status: 'compacting', session_id: 'native' } as SDKMessage;
    yield { type: 'system', subtype: 'compact_boundary', session_id: 'native',
      compact_metadata: { trigger: 'manual', pre_tokens: 10000, post_tokens: 3000 } } as SDKMessage;
    yield { type: 'result', subtype: 'success', session_id: 'native' } as SDKMessage;
  };
  expect(await runClaudeCompact({ cwd: process.cwd(), nativeId: 'native', model: 'claude-sonnet-5',
    effort: 'medium', controller: new AbortController(), start: () => stream() })).toEqual({
    confirmed: true, boundary: { preTokens: 10000, postTokens: 3000 },
  });
});

test.each(['auto-boundary', 'result-without-boundary', 'failed-result'] as const)(
  'local slash compact %s cannot be reported as success', async scenario => {
    const log = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const stream = async function* (): AsyncGenerator<SDKMessage> {
        yield { type: 'system', subtype: 'status', status: 'compacting', session_id: 'native' } as SDKMessage;
        if (scenario !== 'result-without-boundary') yield { type: 'system', subtype: 'compact_boundary',
          session_id: 'native', compact_metadata: { trigger: scenario === 'auto-boundary' ? 'auto' : 'manual',
            pre_tokens: 10000 } } as SDKMessage;
        yield { type: 'result', subtype: scenario === 'failed-result' ? 'error_during_execution' : 'success',
          is_error: scenario === 'failed-result', session_id: 'native' } as SDKMessage;
      };
      await expect(runClaudeCompact({ cwd: process.cwd(), nativeId: 'native', model: 'claude-sonnet-5',
        effort: 'medium', controller: new AbortController(), start: () => stream() })).rejects.toThrow();
    } finally { log.mockRestore(); }
  },
);

test('failed compact status cannot be overridden by a later success result', async () => {
  const log = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const stream = async function* (): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: 'native' } as SDKMessage;
      yield { type: 'system', subtype: 'status', status: null, compact_result: 'failed',
        session_id: 'native' } as SDKMessage;
      yield { type: 'system', subtype: 'compact_boundary', session_id: 'native',
        compact_metadata: { trigger: 'manual', pre_tokens: 10000 } } as SDKMessage;
      yield { type: 'result', subtype: 'success', session_id: 'native' } as SDKMessage;
    };
    await expect(runClaudeCompact({ cwd: process.cwd(), nativeId: 'native', model: 'claude-sonnet-5',
      effort: 'medium', controller: new AbortController(), start: () => stream() })).rejects.toThrow();
  } finally { log.mockRestore(); }
});

test('pre-init progress without init or result is uncertain, not a confirmed compact', async () => {
  const log = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const stream = async function* (): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'status', status: 'compacting', session_id: 'native' } as SDKMessage;
    };
    await expect(runClaudeCompact({ cwd: process.cwd(), nativeId: 'native', model: 'claude-sonnet-5',
      effort: 'medium', controller: new AbortController(), start: () => stream() })).rejects.toThrow();
  } finally { log.mockRestore(); }
});

test('lost compact result blocks retry and subsequent Claude messages', async () => {
  const { wire, events } = wireFixture();
  const exec = createClaudeExecution({ version: () => '2.1.278', start: (prompt, options) => {
    const id = options.sessionId ?? options.resume;
    async function* stream(): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', session_id: id } as SDKMessage;
      if (typeof prompt === 'string') throw new Error('lost compact response');
      yield { type: 'result', subtype: 'success', session_id: id, result: 'hello' } as SDKMessage;
    }
    return stream();
  } });
  await exec.sendMessage(wire, 'origin', 'session', 'hello');
  expect(await exec.compact('session', 'manual', wire.delivery)).toMatchObject({ ok: false });
  expect(getSession('session')?.metadata?.claudeCompactPending).toBe(true);
  expect(await exec.compact('session', 'manual', wire.delivery)).toMatchObject({ ok: false, skipped: true });
  const before = listMessagesWithParts('session').length;
  await exec.sendMessage(wire, 'origin', 'session', 'retry');
  expect(listMessagesWithParts('session')).toHaveLength(before);
  expect(events.at(-1)).toMatchObject({ type: 'error', code: 'invalid_session' });
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
