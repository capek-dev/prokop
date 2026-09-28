import { query, type CanUseTool, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeImage } from './images';
import { claudeCliVersion } from './version';
import { parseClaudeUsage, type ClaudeTurnUsage } from './usage';

export type ClaudeTurnEvent = (
  | { type: 'text-delta'; text: string }
  | { type: 'text-final'; text: string; streamed: string }
  | { type: 'tool-start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool-end'; id: string; output: unknown; failed: boolean }
  | { type: 'child-start'; id: string; background: boolean }
  | { type: 'child-finish'; id: string; status: 'completed' | 'error' | 'interrupted' }
  | { type: 'result'; text: string; success: boolean; usage: ClaudeTurnUsage | null }
  | { type: 'context-usage'; used: number; window: number }
  | { type: 'compact-boundary'; trigger: 'auto' | 'manual'; preTokens: number; postTokens: number | null }
) & { parentToolUseId?: string };

export interface ClaudeTurnInput {
  cwd: string;
  prompt: string;
  images?: ClaudeImage[];
  sessionId: string;
  resume: boolean;
  model: string;
  effort: string;
  controller: AbortController;
  canUseTool: CanUseTool;
  onToolOwner?: (toolUseId: string, parentToolUseId?: string) => void;
  /** A fake query source for offline tests. */
  start?: (prompt: string | AsyncIterable<SDKUserMessage>, options: Options) => AsyncIterable<SDKMessage>;
}

const MAX_OUTPUT = 8_000;
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function outsideTurn(message: SDKMessage): Error {
  // Only expose SDK event discriminants, never message content or arbitrary subtype text.
  const subtype = message.type === 'system' && /^[a-z_]{1,48}$/.test(message.subtype)
    ? `/${message.subtype}` : '';
  return new Error(`Claude CLI event outside turn (before init: ${message.type}${subtype})`);
}

/** The SDK drives the installed executable's native tool loop; Prokop never executes its tools. */
export async function* runClaudeTurn(input: ClaudeTurnInput): AsyncGenerator<ClaudeTurnEvent> {
  if (!input.prompt.trim() && !input.images?.length) throw new Error('Claude CLI requires a nonempty prompt');
  const executable = input.start ? 'claude' : Bun.which('claude');
  if (!executable) throw new Error('Claude CLI is unavailable on this host');
  if (!input.start) claudeCliVersion();
  const { ANTHROPIC_API_KEY: _apiKey, ANTHROPIC_AUTH_TOKEN: _authToken,
    CLAUDE_CODE_USE_BEDROCK: _bedrock, CLAUDE_CODE_USE_VERTEX: _vertex,
    CLAUDE_CODE_USE_FOUNDRY: _foundry, ...env } = process.env;
  const approvedToolIds = new Map<string, { name: string; input: string }>();
  let streamClosed = false;
  const options: Options = {
    pathToClaudeCodeExecutable: executable,
    cwd: input.cwd,
    model: input.model,
    ...(input.effort === 'default' ? {} : { effort: input.effort as NonNullable<Options['effort']> }),
    ...(input.resume ? { resume: input.sessionId } : { sessionId: input.sessionId }),
    abortController: input.controller,
    persistSession: true,
    includePartialMessages: true,
    forwardSubagentText: true,
    permissionMode: 'default',
    permissionPrompts: 'host',
    canUseTool: async (name, value, context) => {
      if (streamClosed) return { behavior: 'deny', message: 'Claude stream has ended' };
      const approved = context.toolUseID ? approvedToolIds.get(context.toolUseID) : undefined;
      if (context.toolUseID) approvedToolIds.delete(context.toolUseID);
      if (approved && approved.name === name && approved.input === JSON.stringify(value)) return { behavior: 'allow' };
      return input.canUseTool(name, value, context);
    },
    // The native permission engine may auto-allow reads. Gate every invocation before it reaches that engine.
    hooks: { PreToolUse: [{ hooks: [async (event, _id, context) => {
      if (event.hook_event_name !== 'PreToolUse') return { continue: false };
      if (streamClosed) return { hookSpecificOutput: { hookEventName: 'PreToolUse',
        permissionDecision: 'deny', permissionDecisionReason: 'Claude stream has ended' } };
      const decision = await input.canUseTool(event.tool_name, event.tool_input as Record<string, unknown>, {
        signal: context.signal, toolUseID: event.tool_use_id, requestId: crypto.randomUUID(),
      });
      if (streamClosed) return { hookSpecificOutput: { hookEventName: 'PreToolUse',
        permissionDecision: 'deny', permissionDecisionReason: 'Claude stream has ended' } };
      if (decision?.behavior === 'allow' && event.tool_use_id) {
        approvedToolIds.set(event.tool_use_id, { name: event.tool_name, input: JSON.stringify(event.tool_input) });
      }
      return { hookSpecificOutput: { hookEventName: 'PreToolUse',
        permissionDecision: decision?.behavior === 'allow' ? 'allow' as const : 'deny' as const,
        ...(decision?.behavior === 'deny' ? { permissionDecisionReason: decision.message } : {}),
      } };
    }] }] },
    tools: { type: 'preset', preset: 'claude_code' },
    allowedTools: [],
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {},
    env: { ...env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_AUTO_CONNECT_IDE: '0' },
  };
  let releaseInput!: () => void;
  const inputReleased = new Promise<void>(resolve => { releaseInput = resolve; });
  // An exhausted streaming-input generator closes stdin and can stop background agents.
  // Keep it open until the terminal result and every observed background Agent settles.
  const prompt = (async function* (): AsyncGenerator<SDKUserMessage> {
    try {
      yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
        ...(input.prompt.trim() ? [{ type: 'text' as const, text: input.prompt }] : []),
        ...(input.images ?? []).map(image => ({ type: 'image' as const,
          source: { type: 'base64' as const, media_type: image.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: image.data } })),
      ] } };
      await inputReleased;
    } finally { releaseInput(); }
  })();
  const messages = input.start ? input.start(prompt, options) : query({ prompt, options });
  let initialized = false;
  let finished = false;
  let sawResult = false;
  const backgroundAgents = new Set<string>();
  const agentTasks = new Map<string, string>();
  const streamedText = new Map<string, string>();
  const releaseIfSettled = (): void => {
    if (finished && backgroundAgents.size === 0) releaseInput();
  };
  try {
    for await (const message of messages) {
    if (input.controller.signal.aborted) throw new Error('Claude turn interrupted');
    if ('session_id' in message && message.session_id !== input.sessionId) throw new Error('Claude CLI session identity changed');
    if ('parent_tool_use_id' in message && message.parent_tool_use_id !== null
      && (typeof message.parent_tool_use_id !== 'string' || !message.parent_tool_use_id
        || message.parent_tool_use_id.length > 256)) throw new Error('Invalid Claude child identity');
    const parentToolUseId = 'parent_tool_use_id' in message && typeof message.parent_tool_use_id === 'string'
      ? message.parent_tool_use_id : undefined;
    const scope = parentToolUseId ?? '';
    const owner = parentToolUseId ? { parentToolUseId } : {};
    if (message.type === 'system' && message.subtype === 'init') {
      // Claude emits init at the start of each turn, including after a result.
      initialized = true;
      finished = false;
      continue;
    }
    if (!initialized) throw outsideTurn(message);
    if (message.type === 'system' && message.subtype === 'task_started'
      && message.task_type === 'local_agent'
      && typeof message.tool_use_id === 'string' && message.tool_use_id) {
      agentTasks.set(message.task_id, message.tool_use_id);
      if (message.is_backgrounded) backgroundAgents.add(message.tool_use_id);
      yield { type: 'child-start', id: message.tool_use_id, background: message.is_backgrounded === true };
    }
    if (message.type === 'system' && message.subtype === 'task_updated'
      && message.patch.is_backgrounded === true) {
      const agentId = agentTasks.get(message.task_id);
      if (agentId) {
        backgroundAgents.add(agentId);
        yield { type: 'child-start', id: agentId, background: true };
      }
    }
    if (message.type === 'system' && message.subtype === 'task_notification') {
      const agentId = agentTasks.get(message.task_id);
      if (agentId) {
        agentTasks.delete(message.task_id);
        backgroundAgents.delete(agentId);
        yield { type: 'child-finish', id: agentId,
          status: message.status === 'completed' ? 'completed'
            : message.status === 'failed' ? 'error' : 'interrupted' };
        releaseIfSettled();
      }
    }
    // Children may emit frames after a result. Ignore parent content until the next init.
    if (finished && !parentToolUseId) continue;
    if (message.type === 'system' && message.subtype === 'compact_boundary') {
      const meta = record(message.compact_metadata);
      if (meta && (meta.trigger === 'auto' || meta.trigger === 'manual')
        && typeof meta.pre_tokens === 'number' && Number.isSafeInteger(meta.pre_tokens)
        && meta.pre_tokens >= 0 && (meta.post_tokens === undefined
          || typeof meta.post_tokens === 'number' && Number.isSafeInteger(meta.post_tokens) && meta.post_tokens >= 0)) {
        yield { type: 'compact-boundary', trigger: meta.trigger, preTokens: meta.pre_tokens,
          postTokens: meta.post_tokens ?? null };
      }
    } else if (message.type === 'stream_event') {
      if (message.event.type === 'content_block_delta' && message.event.delta.type === 'text_delta') {
        streamedText.set(scope, (streamedText.get(scope) ?? '') + message.event.delta.text);
        yield { type: 'text-delta', text: message.event.delta.text, ...owner };
      }
    } else if (message.type === 'assistant') {
      const completedText = message.message.content.filter(block => block.type === 'text')
        .map(block => block.text).join('');
      const streamed = streamedText.get(scope) ?? '';
      if (completedText || streamed) yield { type: 'text-final', text: completedText, streamed, ...owner };
      streamedText.delete(scope);
      for (const block of message.message.content) {
        if (block.type === 'text') continue;
        else if (block.type === 'tool_use') {
          if (!block.name || !block.id || !record(block.input)) throw new Error('Malformed Claude tool event');
          input.onToolOwner?.(block.id, parentToolUseId);
          yield { type: 'tool-start', id: block.id, name: block.name, input: record(block.input)!, ...owner };
        } else if (block.type !== 'thinking' && block.type !== 'redacted_thinking') {
          throw new Error('Unknown Claude content block');
        }
      }
    } else if (message.type === 'user') {
      const blocks = Array.isArray(message.message.content) ? message.message.content : [];
      for (const block of blocks) {
        if (block.type !== 'tool_result') continue;
        const value = typeof block.content === 'string' ? block.content
          : JSON.stringify(block.content ?? '');
        yield { type: 'tool-end', id: block.tool_use_id,
          output: value.slice(0, MAX_OUTPUT), failed: block.is_error === true, ...owner };
      }
    } else if (message.type === 'result') {
      const firstResult = !sawResult;
      finished = true;
      sawResult = true;
      yield { type: 'result', text: message.subtype === 'success' ? message.result : '',
        success: message.subtype === 'success' && !message.is_error,
        usage: parseClaudeUsage(message.modelUsage, input.model) };
      if (firstResult && message.subtype === 'success' && 'getContextUsage' in messages
        && typeof messages.getContextUsage === 'function') {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const context = await Promise.race([
            messages.getContextUsage({ detail: 'summary' }),
            new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 2000); }),
          ]);
          if (context && Number.isSafeInteger(context.totalTokens) && context.totalTokens >= 0
            && Number.isSafeInteger(context.rawMaxTokens) && context.rawMaxTokens > 0) {
            yield { type: 'context-usage', used: context.totalTokens, window: context.rawMaxTokens };
          }
        } catch { /* Older CLI builds may not support context usage. */ }
        finally { if (timeout) clearTimeout(timeout); }
      }
      releaseIfSettled();
    }
    }
    if (!sawResult || !finished) throw new Error('Claude CLI exited without a terminal result');
  } finally {
    releaseInput();
    streamClosed = true;
    approvedToolIds.clear();
  }
}
