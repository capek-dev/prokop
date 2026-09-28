import { expect, test } from 'bun:test';
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { runClaudeTurn } from '@/harnesses/claude-cli/sdk-turn';

function event(value: unknown): SDKMessage { return value as SDKMessage; }

const base = { cwd: process.cwd(), prompt: 'read a file', sessionId: crypto.randomUUID(),
  resume: false, model: 'claude-sonnet-5', effort: 'medium', controller: new AbortController() };

test('SDK hook gates even native auto-approved tools and preserves tool lifecycle', async () => {
  const approvals: string[] = [];
  let options: Options | undefined;
  const messages = runClaudeTurn({ ...base,
    canUseTool: async (name) => { approvals.push(name); return { behavior: 'allow' }; },
    start: (_prompt, config) => {
      options = config;
      async function* stream(): AsyncGenerator<SDKMessage> {
        const hook = config.hooks?.PreToolUse?.[0]?.hooks[0];
        expect(hook).toBeDefined();
        const decision = await hook!({ hook_event_name: 'PreToolUse', tool_name: 'Read',
          tool_input: { file_path: 'README.md' }, tool_use_id: 'tool-1' } as never, 'tool-1',
        { signal: base.controller.signal });
        expect(decision).toMatchObject({ hookSpecificOutput: { permissionDecision: 'allow' } });
        const permitted = await config.canUseTool!('Read', { file_path: 'README.md' }, {
          signal: base.controller.signal, toolUseID: 'tool-1', requestId: crypto.randomUUID(),
        });
        expect(permitted).toMatchObject({ behavior: 'allow' });
        yield event({ type: 'system', subtype: 'init', session_id: base.sessionId });
        yield event({ type: 'assistant', parent_tool_use_id: null, session_id: base.sessionId,
          message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'README.md' } }] } });
        yield event({ type: 'user', parent_tool_use_id: null, session_id: base.sessionId,
          message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file body' }] } });
        yield event({ type: 'result', subtype: 'success', is_error: false, session_id: base.sessionId, result: 'done' });
      }
      return stream();
    },
  });
  const collected = [];
  for await (const item of messages) collected.push(item);
  expect(approvals).toEqual(['Read']);
  expect(options).toMatchObject({ persistSession: true, sessionId: base.sessionId,
    model: 'claude-sonnet-5', effort: 'medium', allowedTools: [], settingSources: [],
    forwardSubagentText: true, tools: { type: 'preset', preset: 'claude_code' } });
  expect(collected).toEqual([
    { type: 'tool-start', id: 'tool-1', name: 'Read', input: { file_path: 'README.md' } },
    { type: 'tool-end', id: 'tool-1', output: 'file body', failed: false },
    { type: 'result', text: 'done', success: true, usage: null },
  ]);
});

test('default Agent and future tools keep parent tool rows while child events stay out of parent text', async () => {
  const approved: string[] = [];
  const collected = [];
  for await (const item of runClaudeTurn({ ...base,
    canUseTool: async name => { approved.push(name); return { behavior: 'allow' }; },
    start: (_prompt, options) => {
      async function* stream(): AsyncGenerator<SDKMessage> {
        const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
        const decision = await hook!({ hook_event_name: 'PreToolUse', tool_name: 'Agent',
          tool_input: { prompt: 'inspect' }, tool_use_id: 'agent-1' } as never, 'agent-1',
        { signal: base.controller.signal });
        expect(decision).toMatchObject({ hookSpecificOutput: { permissionDecision: 'allow' } });
        expect(await options.canUseTool!('Agent', { prompt: 'inspect' }, {
          signal: base.controller.signal, toolUseID: 'agent-1', requestId: crypto.randomUUID(),
        })).toMatchObject({ behavior: 'allow' });
        yield event({ type: 'system', subtype: 'init', session_id: base.sessionId });
        yield event({ type: 'assistant', session_id: base.sessionId, parent_tool_use_id: null,
          message: { content: [{ type: 'tool_use', name: 'Agent', id: 'agent-1', input: { prompt: 'inspect' } }] } });
        yield event({ type: 'assistant', session_id: base.sessionId, parent_tool_use_id: 'agent-1',
          message: { content: [{ type: 'tool_use', name: 'Read', id: 'child-read', input: {} },
            { type: 'text', text: 'child text' }] } });
        yield event({ type: 'user', session_id: base.sessionId, parent_tool_use_id: 'agent-1',
          message: { content: [{ type: 'tool_result', tool_use_id: 'child-read', content: 'child result' }] } });
        yield event({ type: 'user', session_id: base.sessionId, parent_tool_use_id: null,
          message: { content: [{ type: 'tool_result', tool_use_id: 'agent-1', content: 'summary' }] } });
        yield event({ type: 'assistant', session_id: base.sessionId, parent_tool_use_id: null,
          message: { content: [{ type: 'tool_use', name: 'FutureBuiltin', id: 'future-1', input: {} }] } });
        yield event({ type: 'user', session_id: base.sessionId, parent_tool_use_id: null,
          message: { content: [{ type: 'tool_result', tool_use_id: 'future-1', content: 'done' }] } });
        yield event({ type: 'result', subtype: 'success', is_error: false, session_id: base.sessionId, result: 'done' });
      }
      return stream();
    },
  })) collected.push(item);
  expect(approved).toEqual(['Agent']);
  expect(collected).toEqual([
    { type: 'tool-start', id: 'agent-1', name: 'Agent', input: { prompt: 'inspect' } },
    { type: 'text-final', text: 'child text', streamed: '', parentToolUseId: 'agent-1' },
    { type: 'tool-start', id: 'child-read', name: 'Read', input: {}, parentToolUseId: 'agent-1' },
    { type: 'tool-end', id: 'child-read', output: 'child result', failed: false, parentToolUseId: 'agent-1' },
    { type: 'tool-end', id: 'agent-1', output: 'summary', failed: false },
    { type: 'tool-start', id: 'future-1', name: 'FutureBuiltin', input: {} },
    { type: 'tool-end', id: 'future-1', output: 'done', failed: false },
    { type: 'result', text: 'done', success: true, usage: null },
  ]);
});

test('reports tool ownership and validated SDK context usage without query totals', async () => {
  const owners: Array<[string, string | undefined]> = [];
  const collected = [];
  for await (const item of runClaudeTurn({ ...base,
    canUseTool: async () => ({ behavior: 'deny', message: 'denied' }),
    onToolOwner: (id, owner) => owners.push([id, owner]),
    start: () => {
      async function* stream(): AsyncGenerator<SDKMessage> {
        yield event({ type: 'system', subtype: 'init', session_id: base.sessionId });
        yield event({ type: 'assistant', session_id: base.sessionId, parent_tool_use_id: 'agent-1',
          message: { content: [{ type: 'tool_use', name: 'Bash', id: 'child-bash', input: { command: 'pwd' } }] } });
        yield event({ type: 'result', subtype: 'success', session_id: base.sessionId, result: 'done' });
      }
      return Object.assign(stream(), { getContextUsage: async () => ({ totalTokens: 50000, rawMaxTokens: 200000 }) });
    },
  })) collected.push(item);
  expect(owners).toEqual([['child-bash', 'agent-1']]);
  expect(collected).toContainEqual({ type: 'context-usage', used: 50000, window: 200000 });
});

test('partial text arrives before complete assistant messages without duplication', async () => {
  const controller = new AbortController();
  const collected = [];
  for await (const item of runClaudeTurn({ ...base, controller, canUseTool: async () => ({ behavior: 'deny', message: 'denied' }),
    start: (_prompt, options) => {
      expect(options.includePartialMessages).toBe(true);
      async function* stream(): AsyncGenerator<SDKMessage> {
        yield event({ type: 'system', subtype: 'init', session_id: base.sessionId });
        yield event({ type: 'stream_event', session_id: base.sessionId, parent_tool_use_id: null,
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } });
        yield event({ type: 'stream_event', session_id: base.sessionId, parent_tool_use_id: null,
          event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private' } } });
        yield event({ type: 'stream_event', session_id: base.sessionId, parent_tool_use_id: null,
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } } });
        yield event({ type: 'assistant', session_id: base.sessionId, parent_tool_use_id: null,
          message: { content: [{ type: 'text', text: 'Hello!' }] } });
        yield event({ type: 'assistant', session_id: base.sessionId, parent_tool_use_id: null,
          message: { content: [{ type: 'text', text: 'Second message' }] } });
        yield event({ type: 'result', subtype: 'success', session_id: base.sessionId,
          is_error: false, result: 'Second message' });
      }
      return stream();
    },
  })) collected.push(item);
  expect(collected).toEqual([
    { type: 'text-delta', text: 'Hel' }, { type: 'text-delta', text: 'lo' },
    { type: 'text-final', streamed: 'Hello', text: 'Hello!' },
    { type: 'text-final', streamed: '', text: 'Second message' },
    { type: 'result', text: 'Second message', success: true, usage: null },
  ]);
});

test('accepts per-turn init and child work after parent result without admitting unrelated parent text', async () => {
  for (const images of [undefined, [{ mimeType: 'image/png', data: 'aGVsbG8=' }]] as const) {
    let closed = false;
    let inputClosed = false;
    let options: Options | undefined;
    let calls = 0;
    const collected = [];
    for await (const item of runClaudeTurn({ ...base, images: images as never,
      canUseTool: async () => { calls++; return { behavior: 'allow' }; },
      start: (prompt, config) => {
        options = config;
        async function* stream(): AsyncGenerator<SDKMessage> {
          try {
            if (typeof prompt === 'string') throw new Error('Expected streaming input');
            const input = prompt[Symbol.asyncIterator]();
            expect((await input.next()).value?.type).toBe('user');
            const inputEnd = input.next().then(value => { inputClosed = value.done === true; });
            yield event({ type: 'system', subtype: 'init', session_id: base.sessionId });
            yield event({ type: 'system', subtype: 'task_started', task_type: 'local_agent',
              task_id: 'task-1', tool_use_id: 'agent-1', is_backgrounded: true, session_id: base.sessionId });
            yield event({ type: 'result', subtype: 'success', is_error: false, session_id: base.sessionId, result: 'done' });
            yield event({ type: 'system', subtype: 'init', session_id: base.sessionId });
            expect(inputClosed).toBe(false);
            expect(await config.canUseTool!('Read', {}, { signal: base.controller.signal,
              toolUseID: 'child-read', requestId: 'child' })).toMatchObject({ behavior: 'allow' });
            yield event({ type: 'assistant', session_id: base.sessionId, parent_tool_use_id: 'agent-1',
              message: { content: [{ type: 'text', text: 'child continued' }] } });
            yield event({ type: 'assistant', session_id: base.sessionId, parent_tool_use_id: null,
              message: { content: [{ type: 'text', text: 'late parent text' }] } });
            yield event({ type: 'system', subtype: 'task_notification', session_id: base.sessionId,
              task_id: 'task-1', status: 'completed' });
            yield event({ type: 'result', subtype: 'success', session_id: base.sessionId, result: 'duplicate' });
            await inputEnd;
            expect(inputClosed).toBe(true);
          } finally { closed = true; }
        }
        return stream();
      },
    })) collected.push(item);
    expect(collected).toEqual([
      { type: 'child-start', id: 'agent-1', background: true },
      { type: 'result', text: 'done', success: true, usage: null },
      { type: 'text-final', text: 'child continued', streamed: '', parentToolUseId: 'agent-1' },
      { type: 'text-final', text: 'late parent text', streamed: '' },
      { type: 'child-finish', id: 'agent-1', status: 'completed' },
      { type: 'result', text: 'duplicate', success: true, usage: null },
    ]);
    expect(closed).toBe(true);
    expect(calls).toBe(1);
    expect(await options!.canUseTool!('Read', {}, { signal: base.controller.signal,
      toolUseID: 'late-tool', requestId: 'late' })).toMatchObject({ behavior: 'deny' });
  }
});

test('tracks a foreground agent moved to the background by task ID', async () => {
  let inputClosed = false;
  const collected = [];
  for await (const item of runClaudeTurn({ ...base,
    canUseTool: async () => ({ behavior: 'deny', message: 'denied' }),
    start: (prompt) => {
      async function* stream(): AsyncGenerator<SDKMessage> {
        if (typeof prompt === 'string') throw new Error('Expected streaming input');
        const reader = prompt[Symbol.asyncIterator]();
        await reader.next();
        const end = reader.next().then(value => { inputClosed = value.done === true; });
        yield event({ type: 'system', subtype: 'init', session_id: base.sessionId });
        yield event({ type: 'system', subtype: 'task_started', session_id: base.sessionId,
          task_id: 'task-2', task_type: 'local_agent', tool_use_id: 'agent-2', is_backgrounded: false });
        yield event({ type: 'system', subtype: 'task_updated', session_id: base.sessionId,
          task_id: 'task-2', patch: { is_backgrounded: true } });
        yield event({ type: 'result', subtype: 'success', session_id: base.sessionId, result: 'done' });
        expect(inputClosed).toBe(false);
        yield event({ type: 'system', subtype: 'task_notification', session_id: base.sessionId,
          task_id: 'task-2', status: 'completed' });
        await end;
        expect(inputClosed).toBe(true);
      }
      return stream();
    },
  })) collected.push(item);
  expect(collected).toEqual([
    { type: 'child-start', id: 'agent-2', background: false },
    { type: 'child-start', id: 'agent-2', background: true },
    { type: 'result', text: 'done', success: true, usage: null },
    { type: 'child-finish', id: 'agent-2', status: 'completed' },
  ]);
});

test('pre-init events still fail closed', async () => {
  await expect(async () => {
    for await (const _message of runClaudeTurn({ ...base,
      canUseTool: async () => ({ behavior: 'deny', message: 'denied' }),
      start: async function* () {
        yield event({ type: 'system', subtype: 'task_notification', session_id: base.sessionId });
      },
    })) { /* consume */ }
  }).toThrow('Claude CLI event outside turn (before init: system/task_notification)');
});

test('SDK hook fails closed on denied tools and rejects changed session identity', async () => {
  const input = { ...base, canUseTool: async () => ({ behavior: 'deny' as const, message: 'not allowed' }),
    start: (_prompt: string | AsyncIterable<SDKUserMessage>, options: Options) => {
      async function* stream(): AsyncGenerator<SDKMessage> {
        const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
        const decision = await hook!({ hook_event_name: 'PreToolUse', tool_name: 'Bash',
          tool_input: { command: 'echo hi' }, tool_use_id: 'tool-2' } as never, 'tool-2',
        { signal: base.controller.signal });
        expect(decision).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
        yield event({ type: 'system', subtype: 'init', session_id: 'wrong-id' });
      }
      return stream();
    } };
  await expect(async () => {
    for await (const _message of runClaudeTurn(input)) { /* consume */ }
  }).toThrow('session identity changed');
});
