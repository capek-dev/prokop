import { query, type CanUseTool, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { claudeCliVersion } from './version';

export type ClaudeTurnEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'text-final'; text: string; streamed: string }
  | { type: 'tool-start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool-end'; id: string; output: unknown; failed: boolean }
  | { type: 'result'; text: string; success: boolean };

export interface ClaudeTurnInput {
  cwd: string;
  prompt: string;
  sessionId: string;
  resume: boolean;
  model: string;
  effort: string;
  controller: AbortController;
  canUseTool: CanUseTool;
  /** A fake query source for offline tests. */
  start?: (prompt: string, options: Options) => AsyncIterable<SDKMessage>;
}

const TOOLS = ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch'];
const MAX_OUTPUT = 8_000;
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The SDK drives the installed executable's native tool loop; Prokop never executes its tools. */
export async function* runClaudeTurn(input: ClaudeTurnInput): AsyncGenerator<ClaudeTurnEvent> {
  if (!input.prompt.trim()) throw new Error('Claude CLI requires a nonempty prompt');
  const executable = input.start ? 'claude' : Bun.which('claude');
  if (!executable) throw new Error('Claude CLI is unavailable on this host');
  if (!input.start) claudeCliVersion();
  const { ANTHROPIC_API_KEY: _apiKey, ANTHROPIC_AUTH_TOKEN: _authToken,
    CLAUDE_CODE_USE_BEDROCK: _bedrock, CLAUDE_CODE_USE_VERTEX: _vertex,
    CLAUDE_CODE_USE_FOUNDRY: _foundry, ...env } = process.env;
  const approvedToolIds = new Map<string, { name: string; input: string }>();
  const options: Options = {
    pathToClaudeCodeExecutable: executable,
    cwd: input.cwd,
    model: input.model,
    ...(input.effort === 'default' ? {} : { effort: input.effort as NonNullable<Options['effort']> }),
    ...(input.resume ? { resume: input.sessionId } : { sessionId: input.sessionId }),
    abortController: input.controller,
    persistSession: true,
    includePartialMessages: true,
    permissionMode: 'default',
    permissionPrompts: 'host',
    canUseTool: async (name, value, context) => {
      const approved = context.toolUseID ? approvedToolIds.get(context.toolUseID) : undefined;
      if (context.toolUseID) approvedToolIds.delete(context.toolUseID);
      if (approved && approved.name === name && approved.input === JSON.stringify(value)) return { behavior: 'allow' };
      return input.canUseTool(name, value, context);
    },
    // The native permission engine may auto-allow reads. Gate every invocation before it reaches that engine.
    hooks: { PreToolUse: [{ hooks: [async (event, _id, context) => {
      if (event.hook_event_name !== 'PreToolUse') return { continue: false };
      const decision = await input.canUseTool(event.tool_name, event.tool_input as Record<string, unknown>, {
        signal: context.signal, toolUseID: event.tool_use_id, requestId: crypto.randomUUID(),
      });
      if (decision?.behavior === 'allow' && event.tool_use_id) {
        approvedToolIds.set(event.tool_use_id, { name: event.tool_name, input: JSON.stringify(event.tool_input) });
      }
      return { hookSpecificOutput: { hookEventName: 'PreToolUse',
        permissionDecision: decision?.behavior === 'allow' ? 'allow' as const : 'deny' as const,
        ...(decision?.behavior === 'deny' ? { permissionDecisionReason: decision.message } : {}),
      } };
    }] }] },
    tools: TOOLS,
    allowedTools: [],
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {},
    env: { ...env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_AUTO_CONNECT_IDE: '0' },
  };
  const messages = input.start ? input.start(input.prompt, options) : query({ prompt: input.prompt, options });
  let initialized = false;
  let finished = false;
  let streamedText = '';
  for await (const message of messages) {
    if (input.controller.signal.aborted) throw new Error('Claude turn interrupted');
    if ('session_id' in message && message.session_id !== input.sessionId) throw new Error('Claude CLI session identity changed');
    if (message.type === 'system' && message.subtype === 'init') {
      if (initialized) throw new Error('Duplicate Claude CLI initialization');
      initialized = true;
      continue;
    }
    if (!initialized || finished) throw new Error('Claude CLI event outside turn');
    if (message.type === 'stream_event') {
      if (message.parent_tool_use_id !== null) throw new Error('Claude child activity is not supported');
      if (message.event.type === 'content_block_delta' && message.event.delta.type === 'text_delta') {
        streamedText += message.event.delta.text;
        yield { type: 'text-delta', text: message.event.delta.text };
      }
    } else if (message.type === 'assistant') {
      if (message.parent_tool_use_id !== null) throw new Error('Claude child activity is not supported');
      const completedText = message.message.content.filter(block => block.type === 'text')
        .map(block => block.text).join('');
      if (completedText || streamedText) yield { type: 'text-final', text: completedText, streamed: streamedText };
      streamedText = '';
      for (const block of message.message.content) {
        if (block.type === 'text') continue;
        else if (block.type === 'tool_use') {
          if (!TOOLS.includes(block.name) || !record(block.input) || !block.id) throw new Error('Unsupported Claude tool event');
          yield { type: 'tool-start', id: block.id, name: block.name, input: record(block.input)! };
        } else if (block.type !== 'thinking' && block.type !== 'redacted_thinking') {
          throw new Error('Unknown Claude content block');
        }
      }
    } else if (message.type === 'user') {
      if (message.parent_tool_use_id !== null) throw new Error('Claude child activity is not supported');
      const blocks = Array.isArray(message.message.content) ? message.message.content : [];
      for (const block of blocks) {
        if (block.type !== 'tool_result') continue;
        const value = typeof block.content === 'string' ? block.content
          : JSON.stringify(block.content ?? '');
        yield { type: 'tool-end', id: block.tool_use_id,
          output: value.slice(0, MAX_OUTPUT), failed: block.is_error === true };
      }
    } else if (message.type === 'result') {
      finished = true;
      yield { type: 'result', text: message.subtype === 'success' ? message.result : '',
        success: message.subtype === 'success' && !message.is_error };
    }
  }
  if (!finished) throw new Error('Claude CLI exited without a terminal result');
}
