import { describe, it, expect } from 'bun:test';
import { buildConversationText, formatOutput, estimateToolOutputSize } from '@capekai/core/execution';
import type { MessageWithParts, ToolPart, TextPart } from '@jean2/sdk';

// ---------------------------------------------------------------------------
// formatOutput
// ---------------------------------------------------------------------------

describe('formatOutput', () => {
  it('returns short strings unchanged', () => {
    expect(formatOutput('hello')).toBe('hello');
  });

  it('truncates strings longer than 500 characters', () => {
    const long = 'a'.repeat(501);
    expect(formatOutput(long)).toBe('a'.repeat(500) + '...(truncated)');
  });

  it('leaves a 500-char string untouched', () => {
    const exact = 'b'.repeat(500);
    expect(formatOutput(exact)).toBe(exact);
  });

  it('serializes objects and truncates if JSON > 500 chars', () => {
    const obj = { key: 'x'.repeat(600) };
    const result = formatOutput(obj);
    expect(result.endsWith('...(truncated)')).toBe(true);
    expect(result.length).toBe(500 + '...(truncated)'.length);
  });

  it('serializes small objects without truncation', () => {
    expect(formatOutput({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('serializes arrays', () => {
    expect(formatOutput([1, 2, 3])).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('handles null', () => {
    expect(formatOutput(null)).toBe('null');
  });

  it('handles numbers', () => {
    expect(formatOutput(42)).toBe('42');
  });

  it('handles booleans', () => {
    expect(formatOutput(true)).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// estimateToolOutputSize
// ---------------------------------------------------------------------------

describe('estimateToolOutputSize', () => {
  it('returns 0 for null', () => {
    expect(estimateToolOutputSize(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(estimateToolOutputSize(undefined)).toBe(0);
  });

  it('returns string length for strings', () => {
    expect(estimateToolOutputSize('hello')).toBe(5);
  });

  it('returns empty string length as 0', () => {
    expect(estimateToolOutputSize('')).toBe(0);
  });

  it('returns JSON length for objects', () => {
    expect(estimateToolOutputSize({ a: 1, b: 2 })).toBe(
      JSON.stringify({ a: 1, b: 2 }).length,
    );
  });

  it('returns JSON length for arrays', () => {
    expect(estimateToolOutputSize([1, 2, 3])).toBe('[1,2,3]'.length);
  });

  it('returns JSON length for numbers', () => {
    expect(estimateToolOutputSize(42)).toBe(2);
  });

  it('returns JSON length for booleans', () => {
    expect(estimateToolOutputSize(true)).toBe(4);
  });

  it('returns 0 for circular references that fail JSON.stringify', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(estimateToolOutputSize(circular)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildConversationText
// ---------------------------------------------------------------------------

function makeTextPart(text: string): TextPart {
  return {
    id: `part-${text}`,
    messageId: 'msg-1',
    createdAt: Date.now(),
    type: 'text',
    text,
  };
}

function makeToolPart(
  name: string,
  state: ToolPart['state'],
): ToolPart {
  return {
    id: `part-tool-${name}`,
    messageId: 'msg-1',
    createdAt: Date.now(),
    type: 'tool',
    callId: `call-${name}`,
    name,
    state,
  };
}

describe('buildConversationText', () => {
  it('returns empty string for empty array', () => {
    expect(buildConversationText([])).toBe('');
  });

  it('skips system messages', () => {
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm1', sessionId: 's1', role: 'system', createdAt: 0 },
        parts: [makeTextPart('system prompt')],
      },
    ];
    expect(buildConversationText(messages)).toBe('');
  });

  it('formats user text messages', () => {
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm1', sessionId: 's1', role: 'user', createdAt: 0 },
        parts: [makeTextPart('Hello')],
      },
    ];
    const result = buildConversationText(messages);
    expect(result).toContain('--- USER ---');
    expect(result).toContain('Hello');
  });

  it('formats assistant text messages', () => {
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm2', sessionId: 's1', role: 'assistant', createdAt: 0, status: 'completed', modelId: 'gpt-4o', providerId: 'openai', tokens: { prompt: 0, completion: 0 }, cost: 0 },
        parts: [makeTextPart('Hi there')],
      },
    ];
    const result = buildConversationText(messages);
    expect(result).toContain('--- ASSISTANT ---');
    expect(result).toContain('Hi there');
  });

  it('formats completed tool parts with output', () => {
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm2', sessionId: 's1', role: 'assistant', createdAt: 0, status: 'completed', modelId: 'gpt-4o', providerId: 'openai', tokens: { prompt: 0, completion: 0 }, cost: 0 },
        parts: [
          makeToolPart('read-file', {
            status: 'completed',
            input: { path: '/tmp/test.txt' },
            output: 'file contents here',
            startedAt: 0,
            completedAt: 1,
          }),
        ],
      },
    ];
    const result = buildConversationText(messages);
    expect(result).toContain('[TOOL: read-file]');
    expect(result).toContain('"path": "/tmp/test.txt"');
    expect(result).toContain('file contents here');
  });

  it('formats errored tool parts with error message', () => {
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm2', sessionId: 's1', role: 'assistant', createdAt: 0, status: 'completed', modelId: 'gpt-4o', providerId: 'openai', tokens: { prompt: 0, completion: 0 }, cost: 0 },
        parts: [
          makeToolPart('bash', {
            status: 'error',
            input: { command: 'exit 1' },
            error: 'Command failed',
            startedAt: 0,
            failedAt: 1,
          }),
        ],
      },
    ];
    const result = buildConversationText(messages);
    expect(result).toContain('[TOOL: bash]');
    expect(result).toContain('Error: Command failed');
  });

  it('skips pending/running tool parts (no output shown)', () => {
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm2', sessionId: 's1', role: 'assistant', createdAt: 0, status: 'completed', modelId: 'gpt-4o', providerId: 'openai', tokens: { prompt: 0, completion: 0 }, cost: 0 },
        parts: [
          makeToolPart('bash', {
            status: 'pending',
            input: { command: 'sleep 5' },
          }),
        ],
      },
    ];
    const result = buildConversationText(messages);
    expect(result).toContain('[TOOL: bash]');
    expect(result).toContain('Input:');
    // No "Output:" or "Error:" line for pending tools
    expect(result).not.toContain('Output:');
    expect(result).not.toContain('Error:');
  });

  it('interleaves multiple messages in order', () => {
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm1', sessionId: 's1', role: 'user', createdAt: 0 },
        parts: [makeTextPart('What is 2+2?')],
      },
      {
        message: { id: 'm2', sessionId: 's1', role: 'assistant', createdAt: 0, status: 'completed', modelId: 'gpt-4o', providerId: 'openai', tokens: { prompt: 0, completion: 0 }, cost: 0 },
        parts: [makeTextPart('The answer is 4.')],
      },
      {
        message: { id: 'm3', sessionId: 's1', role: 'user', createdAt: 0 },
        parts: [makeTextPart('Thanks!')],
      },
    ];
    const result = buildConversationText(messages);
    const userIdx = result.indexOf('--- USER ---');
    const asstIdx = result.indexOf('--- ASSISTANT ---');
    const user2Idx = result.indexOf('--- USER ---', userIdx + 1);
    expect(userIdx).toBeLessThan(asstIdx);
    expect(asstIdx).toBeLessThan(user2Idx);
  });

  it('truncates long tool output via formatOutput', () => {
    const longOutput = 'z'.repeat(600);
    const messages: MessageWithParts[] = [
      {
        message: { id: 'm2', sessionId: 's1', role: 'assistant', createdAt: 0, status: 'completed', modelId: 'gpt-4o', providerId: 'openai', tokens: { prompt: 0, completion: 0 }, cost: 0 },
        parts: [
          makeToolPart('read-file', {
            status: 'completed',
            input: { path: '/big.txt' },
            output: longOutput,
            startedAt: 0,
            completedAt: 1,
          }),
        ],
      },
    ];
    const result = buildConversationText(messages);
    expect(result).toContain('...(truncated)');
    expect(result).not.toContain('z'.repeat(600));
  });
});
