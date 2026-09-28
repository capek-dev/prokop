import { expect, test } from 'bun:test';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
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
    tools: { type: 'preset', preset: 'claude_code' } });
  expect(collected).toEqual([
    { type: 'tool-start', id: 'tool-1', name: 'Read', input: { file_path: 'README.md' } },
    { type: 'tool-end', id: 'tool-1', output: 'file body', failed: false },
    { type: 'result', text: 'done', success: true },
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
        yield event({ type: 'stream_event', session_id: base.sessionId, parent_tool_use_id: 'agent-1',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'child only' } } });
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
    { type: 'tool-end', id: 'agent-1', output: 'summary', failed: false },
    { type: 'tool-start', id: 'future-1', name: 'FutureBuiltin', input: {} },
    { type: 'tool-end', id: 'future-1', output: 'done', failed: false },
    { type: 'result', text: 'done', success: true },
  ]);
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
    { type: 'result', text: 'Second message', success: true },
  ]);
});

test('SDK hook fails closed on denied tools and rejects changed session identity', async () => {
  const input = { ...base, canUseTool: async () => ({ behavior: 'deny' as const, message: 'not allowed' }),
    start: (_prompt: string, options: Options) => {
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
