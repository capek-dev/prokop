/** Parse the installed Claude CLI's --output-format stream-json stdout. */
export type ClaudeStreamEvent =
  | { type: 'init'; sessionId: string }
  | { type: 'text'; sessionId: string; text: string }
  | { type: 'tool'; sessionId: string; id: string; name: string; input: unknown }
  | { type: 'result'; sessionId: string; success: boolean; text: string };

const MAX_LINE_BYTES = 2 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Parse one complete event, rejecting malformed messages rather than treating them as success. */
export function parseClaudeEvent(value: unknown): ClaudeStreamEvent | null {
  const event = object(value);
  if (!event) throw new Error('Invalid Claude CLI event');
  const sessionId = event.session_id;
  if (typeof sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(sessionId)) {
    throw new Error('Invalid Claude CLI session identity');
  }
  if (event.type === 'system') {
    if (event.subtype === 'init') return { type: 'init', sessionId };
    return null;
  }
  if (event.type === 'assistant') {
    if (event.parent_tool_use_id !== null) throw new Error('Claude CLI child activity requires a tool-aware execution adapter');
    const message = object(event.message);
    if (!message || !Array.isArray(message.content)) throw new Error('Invalid Claude CLI assistant message');
    const text: string[] = [];
    const tools: ClaudeStreamEvent[] = [];
    for (const blockValue of message.content) {
      const block = object(blockValue);
      if (!block) throw new Error('Invalid Claude CLI content block');
      if (block.type === 'text' && typeof block.text === 'string') text.push(block.text);
      else if (block.type === 'tool_use') {
        if (typeof block.id !== 'string' || !block.id || typeof block.name !== 'string' || !block.name) {
          throw new Error('Invalid Claude CLI tool identity');
        }
        tools.push({ type: 'tool', sessionId, id: block.id, name: block.name, input: block.input });
      } else if (block.type !== 'thinking' && block.type !== 'redacted_thinking') {
        throw new Error('Unknown Claude CLI content block');
      }
    }
    if (tools.length > 0) throw new Error('Claude CLI tool events require a tool-aware execution adapter');
    return text.length ? { type: 'text', sessionId, text: text.join('') } : null;
  }
  if (event.type === 'result') {
    if (typeof event.is_error !== 'boolean' || typeof event.result !== 'string') {
      throw new Error('Invalid Claude CLI result');
    }
    return { type: 'result', sessionId, success: !event.is_error && event.subtype === 'success', text: event.result };
  }
  if (event.type === 'user' || event.type === 'stream_event' || event.type === 'rate_limit_event') return null;
  throw new Error('Unknown Claude CLI event');
}

/** Consume bounded NDJSON, requiring a single matching init and a terminal result. */
export async function* readClaudeStream(
  stdout: ReadableStream<Uint8Array>, expectedSessionId?: string,
): AsyncGenerator<ClaudeStreamEvent> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const reader = stdout.getReader();
  let buffer = '';
  let sessionId = expectedSessionId;
  let initialized = false;
  let finished = false;
  const parseLine = (line: string): ClaudeStreamEvent | null => {
    let value: unknown;
    try { value = JSON.parse(line) as unknown; } catch { throw new Error('Invalid Claude CLI JSON'); }
    const event = parseClaudeEvent(value);
    const rawSessionId = object(value)?.session_id;
    if (sessionId && rawSessionId !== sessionId) throw new Error('Claude CLI session identity changed');
    if (!event) return null;
    sessionId = event.sessionId;
    if (event.type === 'init') {
      if (initialized) throw new Error('Duplicate Claude CLI initialization');
      initialized = true;
    } else if (!initialized || finished) {
      throw new Error('Claude CLI event outside turn');
    }
    if (event.type === 'result') finished = true;
    return event;
  };
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES && !buffer.includes('\n')) {
        throw new Error('Claude CLI event exceeds size limit');
      }
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error('Claude CLI event exceeds size limit');
        if (!line.trim()) continue;
        const event = parseLine(line);
        if (event) yield event;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) throw new Error('Claude CLI event exceeds size limit');
      const event = parseLine(buffer);
      if (event) yield event;
    }
    if (!finished) throw new Error('Claude CLI exited without a terminal result');
  } finally {
    reader.releaseLock();
  }
}
