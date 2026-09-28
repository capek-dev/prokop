import { expect, test } from 'bun:test';
import { claudeTextTurnArgs } from '@/harnesses/claude-cli/command';
import { parseClaudeEvent, readClaudeStream } from '@/harnesses/claude-cli/stream';

const sessionId = '8ff16bb5-e2ac-4892-ae7c-a24ec8e5701d';
const otherId = 'f79bc593-2202-46ba-b734-931cd1b6963e';
const init = { type: 'system', subtype: 'init', session_id: sessionId };
const text = { type: 'assistant', session_id: sessionId, parent_tool_use_id: null,
  message: { content: [{ type: 'text', text: 'Hello' }] } };
const result = { type: 'result', subtype: 'success', session_id: sessionId,
  is_error: false, result: 'Hello' };

function stream(...lines: unknown[]): ReadableStream<Uint8Array> {
  const data = new TextEncoder().encode(lines.map(line => JSON.stringify(line)).join('\n'));
  return new ReadableStream({ start(controller) {
    const midpoint = Math.floor(data.length / 2);
    controller.enqueue(data.slice(0, midpoint));
    controller.enqueue(data.slice(midpoint));
    controller.close();
  } });
}

async function consume(...events: unknown[]) {
  const parsed = [];
  for await (const event of readClaudeStream(stream(...events))) parsed.push(event);
  return parsed;
}

test('builds a local CLI text turn without bypass or alternate authentication', () => {
  const args = claudeTextTurnArgs(sessionId);
  expect(args.slice(0, 2)).toEqual(['claude', '--print']);
  expect(args).toContain('--safe-mode');
  expect(args).toContain('--permission-prompts');
  expect(args).toContain('none');
  expect(args).toContain('dontAsk');
  expect(args).toContain('--tools');
  expect(args.at(args.indexOf('--tools') + 1)).toBe('');
  expect(args.slice(-2)).toEqual(['--resume', sessionId]);
  expect(args).not.toContain('--bare');
  expect(args).not.toContain('--dangerously-skip-permissions');
  expect(() => claudeTextTurnArgs('--bad')).toThrow('resume identity');
});

test('decodes split NDJSON, validates session identity and requires terminal result', async () => {
  expect(await consume(init, text, result)).toEqual([
    { type: 'init', sessionId },
    { type: 'text', sessionId, text: 'Hello' },
    { type: 'result', sessionId, success: true, text: 'Hello' },
  ]);
  await expect(consume(init, text)).rejects.toThrow('terminal result');
  await expect(consume(text, result)).rejects.toThrow('outside turn');
  await expect(consume(init, { ...result, session_id: otherId })).rejects.toThrow('identity changed');
  await expect(consume(init, init, result)).rejects.toThrow('Duplicate');
  await expect(consume(init, result, text)).rejects.toThrow('outside turn');
});

test('fails closed on tool use, malformed JSON, unknown events and false results', async () => {
  const tool = { ...text, message: { content: [{ type: 'tool_use', id: 'call-1',
    name: 'Bash', input: { command: 'echo unsafe' } }] } };
  await expect(consume(init, tool, result)).rejects.toThrow('tool-aware');
  await expect(consume(init, { ...text, parent_tool_use_id: 'call-1' }, result))
    .rejects.toThrow('tool-aware');
  await expect(consume(init, { type: 'user', session_id: otherId }, result))
    .rejects.toThrow('identity changed');
  await expect(consume(init, { ...result, result: null })).rejects.toThrow('Invalid Claude CLI result');
  await expect(consume(init, { type: 'surprise', session_id: sessionId }, result)).rejects.toThrow('Unknown');
  const broken = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{broken}\n'));
    controller.close();
  } });
  const read = async () => { for await (const _event of readClaudeStream(broken)) { /* consume */ } };
  await expect(read()).rejects.toThrow('Invalid Claude CLI JSON');
  expect(parseClaudeEvent({ ...result, is_error: true })).toEqual({
    type: 'result', sessionId, success: false, text: 'Hello',
  });
});
