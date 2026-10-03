import { expect, test } from 'bun:test';
import { parseClaudeUsageLimits, readClaudeUsageLimits } from '@/harnesses/claude-cli/usage-limits';
import { parseCodexUsageLimits, readCodexUsageLimits } from '@/harnesses/codex-cli/usage-limits';
import { createUsageLimitsCache, unavailableUsageLimits, usageLimits } from '@/harnesses/shared/usage-limits';
import type { CodexConnection } from '@/harnesses/codex-cli/app-server';

const withoutTime = <T extends { checkedAt: string }>(value: T) => ({ ...value, checkedAt: 'now' });

test('Claude get_usage maps 5-hour, weekly, and per-model windows', () => {
  const parsed = parseClaudeUsageLimits({
    subscription_type: 'max',
    rate_limits_available: true,
    rate_limits: {
      seven_day: { utilization: 6, resets_at: '2026-10-06T16:00:00.104Z' },
      five_hour: { utilization: 118, resets_at: '2026-10-03T18:00:00.104Z' },
      seven_day_opus: { utilization: null, resets_at: null },
      seven_day_oauth_apps: { utilization: 50, resets_at: null },
      model_scoped: [{ display_name: 'Fable', utilization: 40, resets_at: 'not a date' }, { utilization: 1 }],
    },
  });
  expect(withoutTime(parsed)).toEqual({
    harness: 'claude-cli', checkedAt: 'now', plan: 'max', windows: [
      { id: 'five_hour', kind: 'session', label: '5-hour', usedPercent: 100, resetsAt: '2026-10-03T18:00:00.104Z' },
      { id: 'seven_day', kind: 'weekly', label: 'Weekly', usedPercent: 6, resetsAt: '2026-10-06T16:00:00.104Z' },
      { id: 'model:Fable', kind: 'weekly', label: 'Weekly (Fable)', usedPercent: 40 },
    ],
  });
});

test('Claude API-key logins are unsupported, not failed', async () => {
  expect(parseClaudeUsageLimits({ subscription_type: null, rate_limits_available: false, rate_limits: null })
    .unavailable?.reason).toBe('unsupported');
  expect((await readClaudeUsageLimits(async () => { throw new Error('spawn failed'); })).unavailable?.reason)
    .toBe('probeFailed');
});

test('Codex windows classify by duration and prefer the main codex bucket', () => {
  const parsed = parseCodexUsageLimits({
    rateLimits: { limitId: 'spark', primary: { usedPercent: 99 } },
    rateLimitsByLimitId: { codex: { limitId: 'codex', planType: 'pro',
      primary: { usedPercent: 9, windowDurationMins: 10080, resetsAt: 1791616919 },
      secondary: null } },
  });
  expect(withoutTime(parsed)).toEqual({
    harness: 'codex-cli', checkedAt: 'now', plan: 'pro', windows: [
      { id: 'primary', kind: 'weekly', label: 'Weekly', usedPercent: 9, resetsAt: '2026-10-10T07:21:59.000Z' },
    ],
  });
  expect(parseCodexUsageLimits({ rateLimits: { planType: 'plus', primary: { usedPercent: 20 }, secondary: { usedPercent: 3 } } })
    .windows.map(window => window.label)).toEqual(['5-hour', 'Weekly']);
  expect(parseCodexUsageLimits({ rateLimits: { planType: 'free', primary: { usedPercent: 20 } } })
    .windows.map(window => window.kind)).toEqual(['monthly']);
  expect(parseCodexUsageLimits({ rateLimits: { planType: null } }).unavailable?.reason).toBe('unsupported');
  expect(parseCodexUsageLimits(null).unavailable?.reason).toBe('probeFailed');
});

function fakeCodex(result: (method: string) => unknown): { connection: CodexConnection; methods: string[] } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const methods: string[] = [];
  const encoder = new TextEncoder();
  const connection: CodexConnection = {
    stdout: new ReadableStream({ start(c) { controller = c; } }),
    stdin: { write(bytes) {
      const request = JSON.parse(new TextDecoder().decode(bytes)) as { id?: number; method: string };
      methods.push(request.method);
      if (request.id !== undefined) queueMicrotask(() => {
        const value = result(request.method);
        const message = value instanceof Error
          ? { id: request.id, error: { code: -32000, message: 'no' } } : { id: request.id, result: value };
        controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
      });
      return bytes.length;
    } },
    exited: new Promise(() => {}),
    kill: () => { try { controller.close(); } catch { /* Closed. */ } },
  };
  return { connection, methods };
}

test('Codex usage read initializes the app-server and fails soft on rejection', async () => {
  const ok = fakeCodex(method => method === 'account/rateLimits/read'
    ? { rateLimits: { primary: { usedPercent: 5, windowDurationMins: 300 } } } : {});
  const read = await readCodexUsageLimits({ connect: () => ok.connection, version: () => 'codex-cli 0.160.0' });
  expect(read.windows).toEqual([{ id: 'primary', kind: 'session', label: '5-hour', usedPercent: 5 }]);
  expect(ok.methods).toEqual(['initialize', 'initialized', 'account/rateLimits/read']);
  const rejected = fakeCodex(method => method === 'account/rateLimits/read' ? new Error('no') : {});
  expect((await readCodexUsageLimits({ connect: () => rejected.connection, version: () => 'x' })).unavailable?.reason)
    .toBe('probeFailed');
});

test('usage cache shares results but retries after a failed read', async () => {
  let reads = 0;
  let fail = true;
  const cached = createUsageLimitsCache(async () => {
    reads++;
    return fail ? unavailableUsageLimits('codex-cli', 'probeFailed', 'down') : usageLimits('codex-cli', null, []);
  });
  await cached();
  fail = false;
  await Promise.all([cached(), cached()]);
  await cached();
  expect(reads).toBe(2);
});
