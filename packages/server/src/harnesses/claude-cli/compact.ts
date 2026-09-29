import { query, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

export interface ClaudeCompactBoundary {
  preTokens: number;
  postTokens: number | null;
}

interface CompactInput {
  cwd: string;
  nativeId: string;
  model: string;
  effort: string;
  controller: AbortController;
  start?: (prompt: string | AsyncIterable<SDKUserMessage>, options: Options) => AsyncIterable<SDKMessage>;
}

/** A slash command is a native SDK input, but a result alone does not prove compaction ran. */
export async function runClaudeCompact(input: CompactInput): Promise<{
  confirmed: boolean;
  boundary: ClaudeCompactBoundary | null;
}> {
  const executable = input.start ? 'claude' : Bun.which('claude');
  if (!executable) throw new Error('Claude CLI is unavailable on this host');
  const { ANTHROPIC_API_KEY: _apiKey, ANTHROPIC_AUTH_TOKEN: _authToken,
    CLAUDE_CODE_USE_BEDROCK: _bedrock, CLAUDE_CODE_USE_VERTEX: _vertex,
    CLAUDE_CODE_USE_FOUNDRY: _foundry, ...env } = process.env;
  const options: Options = {
    pathToClaudeCodeExecutable: executable,
    cwd: input.cwd,
    resume: input.nativeId,
    model: input.model,
    ...(input.effort === 'default' ? {} : { effort: input.effort as NonNullable<Options['effort']> }),
    abortController: input.controller,
    persistSession: true,
    permissionMode: 'default',
    permissionPrompts: 'host',
    canUseTool: async () => ({ behavior: 'deny', message: 'Tools are unavailable during compaction' }),
    hooks: { PreToolUse: [{ hooks: [async () => ({ hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: 'Tools are unavailable during compaction',
    } })] }] },
    tools: [],
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {},
    env: { ...env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_AUTO_CONNECT_IDE: '0' },
  };
  const messages = input.start ? input.start('/compact', options) : query({ prompt: '/compact', options });
  let initialized = false;
  let result: boolean | null = null;
  let boundary: ClaudeCompactBoundary | null = null;
  let invalidStream = false;
  let preInitStatuses = 0;
  let rateLimitEvents = 0;
  let lastEvent = 'none';
  let lastStatus: 'compacting' | 'requesting' | 'idle' | 'unknown' | null = null;
  const knownSystemSubtypes = new Set([
    'init', 'compact_boundary', 'status', 'informational', 'local_command_output',
    'auth_status', 'commands_changed', 'session_state_changed', 'api_retry',
    'task_started', 'task_updated', 'task_notification', 'post_turn_summary', 'task_summary',
  ]);
  const knownMessageTypes = new Set([
    'assistant', 'user', 'stream_event', 'result', 'autocompact_state', 'active_goal',
    'rate_limit_event',
  ]);
  const recentEvents: Array<{
    event: string;
    session: 'match' | 'mismatch' | 'absent';
    status?: 'compacting' | 'requesting' | 'idle' | 'unknown';
    compactResult?: 'success' | 'failed' | 'absent' | 'unknown';
    compactError?: boolean;
  }> = [];
  let eventCount = 0;
  try {
    for await (const message of messages) {
      lastEvent = message.type === 'system'
        ? `system:${knownSystemSubtypes.has(message.subtype) ? message.subtype : 'unknown'}`
        : knownMessageTypes.has(message.type) ? message.type : 'unknown';
      // Only event discriminants and identity comparison, never content or session IDs.
      eventCount++;
      const session = 'session_id' in message
        ? message.session_id === input.nativeId ? 'match' : 'mismatch' : 'absent';
      if (message.type === 'system' && message.subtype === 'status') {
        lastStatus = message.status === null ? 'idle'
          : message.status === 'compacting' || message.status === 'requesting' ? message.status : 'unknown';
        recentEvents.push({ event: lastEvent, session, status: lastStatus,
          compactResult: message.compact_result === undefined ? 'absent'
            : message.compact_result === 'success' || message.compact_result === 'failed'
              ? message.compact_result : 'unknown',
          compactError: message.compact_error !== undefined });
      } else {
        recentEvents.push({ event: lastEvent, session });
      }
      if (recentEvents.length > 12) recentEvents.shift();
      if (input.controller.signal.aborted) throw new Error('Claude compaction interrupted');
      if ('session_id' in message && message.session_id !== input.nativeId) {
        invalidStream = true;
        throw new Error('Claude CLI session identity changed');
      }
      // Slash-command status can change from compacting to idle before init.
      // Neither status nor compact_result:success confirms completion.
      if (!initialized && message.type === 'system' && message.subtype === 'status'
        && message.session_id === input.nativeId && message.compact_error === undefined
        && (message.status === 'compacting' && message.compact_result === undefined
          || message.status === null && preInitStatuses > 0
            && (message.compact_result === undefined || message.compact_result === 'success'))
        && ++preInitStatuses <= 8) continue;
      // Rate-limit updates are informational, not a compact result. The SDK can emit
      // one between progress and init; never let it replace boundary/result evidence.
      if (message.type === 'rate_limit_event' && message.session_id === input.nativeId
        && (initialized || preInitStatuses > 0) && result === null && ++rateLimitEvents <= 16) continue;
      if (message.type === 'system' && message.subtype === 'init' && result === null && !initialized) {
        initialized = true;
        continue;
      }
      // Local slash commands may bypass the usual turn init. In that case, only a
      // same-session manual boundary after compacting progress can precede the result.
      if (!initialized && preInitStatuses > 0 && result === null
        && message.type === 'system' && message.subtype === 'compact_boundary'
        && message.session_id === input.nativeId) {
        const meta = message.compact_metadata;
        if (meta?.trigger === 'manual' && Number.isSafeInteger(meta.pre_tokens) && meta.pre_tokens >= 0
          && (meta.post_tokens === undefined || Number.isSafeInteger(meta.post_tokens) && meta.post_tokens >= 0)) {
          boundary = { preTokens: meta.pre_tokens, postTokens: meta.post_tokens ?? null };
          continue;
        }
      }
      if (!initialized && preInitStatuses > 0 && boundary && result === null && message.type === 'result'
        && message.session_id === input.nativeId) {
        result = message.subtype === 'success' && !message.is_error;
        continue;
      }
      if (!initialized || result !== null) {
        invalidStream = true;
        throw new Error('Claude compact event outside command');
      }
      if (message.type === 'system' && message.subtype === 'status' && message.compact_result === 'failed') {
        invalidStream = true;
        throw new Error('Claude compact reported failure');
      }
      if (message.type === 'system' && message.subtype === 'compact_boundary') {
        const meta = message.compact_metadata;
        if (meta?.trigger === 'manual' && Number.isSafeInteger(meta.pre_tokens) && meta.pre_tokens >= 0
          && (meta.post_tokens === undefined || Number.isSafeInteger(meta.post_tokens) && meta.post_tokens >= 0)) {
          boundary = { preTokens: meta.pre_tokens, postTokens: meta.post_tokens ?? null };
        }
      }
      if (message.type === 'result') result = message.subtype === 'success' && !message.is_error;
    }
  } catch (error) {
    // Never log SDK error text: it may contain prompt or credential material.
    console.warn('[claude-cli] compact stream error', { initialized, lastEvent, lastStatus, boundarySeen: !!boundary,
      terminalResult: result, invalidStream, aborted: input.controller.signal.aborted,
      errorType: error instanceof Error ? error.name : 'unknown', eventCount, recentEvents });
    // Single-shot SDK queries can throw after an error result. Only a failure with no boundary
    // is settled; a boundary followed by an error may already have changed the native session.
    if (result !== false || boundary || invalidStream || input.controller.signal.aborted) throw error;
  }
  if (result === null || input.controller.signal.aborted || result === false && boundary) {
    console.warn('[claude-cli] compact stream incomplete', { initialized, lastEvent, lastStatus, boundarySeen: !!boundary,
      terminalResult: result, aborted: input.controller.signal.aborted, eventCount, recentEvents });
    throw new Error('Claude compact outcome is uncertain');
  }
  return { confirmed: true, boundary: result ? boundary : null };
}
