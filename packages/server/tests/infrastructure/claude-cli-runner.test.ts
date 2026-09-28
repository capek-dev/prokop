import { expect, test } from 'bun:test';
import { runClaudeTextTurn, type ClaudeProcess } from '@/harnesses/claude-cli/runner';

const sessionId = '8ff16bb5-e2ac-4892-ae7c-a24ec8e5701d';

function fixture(events: unknown[], exitCode = 0) {
  const bytes = new TextEncoder().encode(events.map(event => JSON.stringify(event)).join('\n'));
  const writes: string[] = [];
  const kills: Array<number | undefined> = [];
  let ended = false;
  const process: ClaudeProcess = {
    stdin: { write(value) { writes.push(new TextDecoder().decode(value)); return value.length; },
      end() { ended = true; } },
    stdout: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    exited: Promise.resolve(exitCode),
    kill(signal) { kills.push(signal); },
  };
  const spawns: Array<{ args: string[]; cwd: string }> = [];
  return { writes, kills, spawns, get ended() { return ended; },
    spawn: (args: string[], cwd: string) => { spawns.push({ args, cwd }); return process; } };
}

async function collect(input: Parameters<typeof runClaudeTextTurn>[0]) {
  const result = [];
  for await (const event of runClaudeTextTurn(input)) result.push(event);
  return result;
}

test('feeds prompt over stdin, uses installed CLI and verifies result and exit', async () => {
  const f = fixture([
    { type: 'system', subtype: 'init', session_id: sessionId },
    { type: 'result', subtype: 'success', session_id: sessionId, is_error: false, result: 'done' },
  ]);
  expect(await collect({ cwd: '/trusted', prompt: 'hello', spawn: f.spawn })).toEqual([
    { type: 'init', sessionId }, { type: 'result', sessionId, success: true, text: 'done' },
  ]);
  expect(f.spawns[0]?.args[0]).toBe('claude');
  expect(f.spawns[0]?.args).not.toContain('hello');
  expect(f.spawns[0]?.cwd).toBe('/trusted');
  expect(f.writes).toEqual(['hello']);
  expect(f.ended).toBe(true);
  expect(f.kills).toHaveLength(1);
});

test('rejects uncertain exits, malformed resume identity and already aborted turns', async () => {
  const events = [{ type: 'system', subtype: 'init', session_id: sessionId },
    { type: 'result', subtype: 'success', session_id: sessionId, is_error: false, result: 'done' }];
  const f = fixture(events, 1);
  await expect(collect({ cwd: '/trusted', prompt: 'hello', spawn: f.spawn }))
    .rejects.toThrow('unsuccessfully');
  expect(f.kills).toHaveLength(1);
  await expect(collect({ cwd: '/trusted', prompt: 'hello', resumeSessionId: 'bad', spawn: f.spawn }))
    .rejects.toThrow('resume identity');
  const signal = AbortSignal.abort();
  await expect(collect({ cwd: '/trusted', prompt: 'hello', signal, spawn: f.spawn }))
    .rejects.toThrow('interrupted');
  expect(f.spawns).toHaveLength(1);
});
