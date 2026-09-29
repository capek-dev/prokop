import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClaudeGoalVerdict } from '@/harnesses/claude-cli/goal-transcript';

const originalConfig = process.env.CLAUDE_CONFIG_DIR;
const dirs: string[] = [];
afterEach(() => {
  if (originalConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalConfig;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(records: unknown[]) {
  const config = mkdtempSync(join(tmpdir(), 'claude-goal-verdict-'));
  dirs.push(config);
  process.env.CLAUDE_CONFIG_DIR = config;
  const root = '/example/workspace';
  const nativeId = crypto.randomUUID();
  const project = join(config, 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  const entry = (attachment: unknown, timestamp = '2026-09-29T09:57:50.900Z', sessionId = nativeId) =>
    ({ type: 'attachment', sessionId, isSidechain: false, timestamp, attachment });
  const write = (items: unknown[]) => writeFileSync(join(project, `${nativeId}.jsonl`),
    items.map(item => JSON.stringify(item)).join('\n') + '\n');
  write(records.map(value => entry(value)));
  return { root, nativeId, write, entry, condition: 'tests pass', startedAt: Date.parse('2026-09-29T09:57:50.000Z') };
}

test('reads a same-session native met verdict after a fresh goal marker', async () => {
  const input = fixture([{ type: 'goal_status', sentinel: true, met: false, condition: 'tests pass' },
    { type: 'goal_status', met: true, iterations: 2, condition: 'tests pass' }]);
  expect(await readClaudeGoalVerdict(input)).toBe(2);
});

test('missing, stale, malformed, other-session and non-met verdicts never unlock', async () => {
  const input = fixture([]);
  const marker = { type: 'goal_status', sentinel: true, met: false, condition: input.condition };
  const met = { type: 'goal_status', met: true, iterations: 1, condition: input.condition };
  for (const records of [
    [input.entry(met)],
    [input.entry(marker), input.entry({ ...met, met: false })],
    [input.entry(marker), input.entry({ ...met, iterations: -1 })],
    [input.entry(marker), input.entry({ ...met, iterations: 0 })],
    [input.entry(marker), input.entry({ ...met, iterations: '1' })],
    [input.entry(marker), { ...input.entry(met), isSidechain: true }],
    [input.entry(marker), input.entry(met, '2026-09-29T09:57:50.900Z', crypto.randomUUID())],
    [input.entry(marker, '2026-09-28T09:57:50.900Z'), input.entry(met)],
    [input.entry(marker), input.entry(met), input.entry({ ...marker, condition: 'another goal' })],
  ]) {
    input.write(records);
    expect(await readClaudeGoalVerdict(input)).toBeNull();
  }
  expect(await readClaudeGoalVerdict({ ...input, nativeId: '../escape' })).toBeNull();
});
