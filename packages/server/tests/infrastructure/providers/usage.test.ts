import { expect, test } from 'bun:test';
import { createProviderUsagePort } from '@/infrastructure/providers/usage';
import { parseProviderUsage } from '@/infrastructure/providers/usage-parsers';

const balance = { is_available: true, balance_infos: [{ currency: 'USD', total_balance: '10.0001', granted_balance: '0', topped_up_balance: '10.0001' }] };
const quota = { code: 200, success: true, data: { level: 'lite', limits: [
  { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 0, nextResetTime: 1_800_000_000_000 },
  { type: 'CREDIT_LIMIT', unit: 6, number: 1, percentage: 20, usage: 100, remaining: 70 },
  { type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 40 },
] } };
const minimax = { base_resp: { status_code: 0 }, model_remains: [{
  model_name: 'MiniMax-M3', current_interval_total_count: 100, current_interval_usage_count: 80,
  current_weekly_remaining_percent: 75, weekly_end_time: 1_800_000_000_000,
}] };

test('DeepSeek preserves currency/precision and genuine zero balances without percentages', () => {
  const result = parseProviderUsage('deepseek', balance);
  expect(result.balances[0]?.remaining).toBe('10.0001');
  expect(result.windows).toEqual([]);
  expect(parseProviderUsage('deepseek', { ...balance, balance_infos: [{ ...balance.balance_infos[0], total_balance: '0.00' }] }).balances[0]?.remaining).toBe('0.00');
  expect(() => parseProviderUsage('deepseek', { ...balance, balance_infos: [{ ...balance.balance_infos[0], total_balance: '' }] })).toThrow();
});

test('Z.AI maps multiple quotas, counts, zero, reset and MCP separately', () => {
  const result = parseProviderUsage('zhipu-coding', quota, 1_799_999_000_000);
  expect(result.plan).toBe('lite');
  expect(result.windows.map(w => [w.label, w.usedPercent])).toEqual([['5-hour', 0], ['1-week', 30], ['MCP allowance', 40]]);
  expect(result.windows[0]?.resetsAt).toBe(new Date(1_800_000_000_000).toISOString());
  expect(parseProviderUsage('zhipu-coding', quota, 0).windows[0]?.resetsAt).toBeUndefined();
});

test('MiniMax usage_count means remaining; weekly percentages and resets remain distinct', () => {
  const result = parseProviderUsage('minimax', minimax);
  expect(result.windows.map(w => w.usedPercent)).toEqual([20, 25]);
  expect(result.windows[1]?.resetsAt).toBe(new Date(1_800_000_000_000).toISOString());
});

test('MiniMax general lane shows five-hour usage and unlimited weekly without video quotas', () => {
  const general = {
    model_name: 'general', start_time: 1_791_039_600_000, end_time: 1_791_057_600_000,
    current_interval_total_count: 0, current_interval_usage_count: 0,
    current_interval_status: 1, current_interval_remaining_percent: 100,
    current_weekly_total_count: 0, current_weekly_usage_count: 0,
    current_weekly_status: 3, current_weekly_remaining_percent: 100,
  };
  const result = parseProviderUsage('minimax', { model_remains: [general, { ...general, model_name: 'video' }],
    services: [{ service_type: 'video', window_type: 'daily' }] });
  expect(result.windows).toEqual([
    { id: 'general-interval-0', label: '5-hour', usedPercent: 0, resetsAt: new Date(general.end_time).toISOString() },
    { id: 'general-weekly-0', label: 'Weekly', unlimited: true },
  ]);
  const limited = parseProviderUsage('minimax', { model_remains: [{ ...general,
    current_interval_remaining_percent: 60, current_weekly_status: 1, current_weekly_remaining_percent: 25,
  }] });
  expect(limited.windows.map(w => w.usedPercent)).toEqual([40, 75]);
  const unknown = parseProviderUsage('minimax', { model_remains: [{ ...general, current_weekly_remaining_percent: null }] });
  expect(unknown.windows).toHaveLength(1);
  expect(parseProviderUsage('minimax', { services: [{ service_type: 'video', window_type: 'daily' }] }).unavailable?.reason).toBe('unsupported');
});

test('MiniMax service quotas accept numeric strings without coercing blank or null to zero', () => {
  const service = { service_type: 'Text generation', window_type: '5 hours', limit: '100', usage: '10', percent: '10' };
  expect(parseProviderUsage('minimax', { data: { services: [service] } }).windows[0]?.usedPercent).toBe(10);
  for (const invalid of ['', null, false, 'NaN']) {
    expect(() => parseProviderUsage('minimax', { data: { services: [{ ...service, usage: invalid }] } })).toThrow();
  }
  expect(() => parseProviderUsage('minimax', { base_resp: { status_code: 1004 }, data: { services: [service] } })).toThrow();
});

test('unknown/empty quotas never imply zero; malformed and provider errors fail', () => {
  expect(parseProviderUsage('zhipu-coding', { code: 200, data: { limits: [{ type: 'NEW' }] } }).unavailable?.reason).toBe('unsupported');
  expect(parseProviderUsage('minimax', { model_remains: [] }).unavailable?.reason).toBe('unsupported');
  expect(() => parseProviderUsage('zhipu-coding', { code: 200, data: { limits: [{ type: 'TOKENS_LIMIT', percentage: null }] } })).toThrow();
  expect(() => parseProviderUsage('minimax', { ...minimax, base_resp: { status_code: 1004 } })).toThrow();
  expect(() => parseProviderUsage('deepseek', {})).toThrow();
  expect(parseProviderUsage('minimax', { model_remains: [{ model_name: 'video', current_interval_status: 3, current_interval_remaining_percent: 100 }] }).unavailable?.reason).toBe('unsupported');
});

test('cache shares reads, expires, and isolates changed/removed credentials', async () => {
  let key: string | undefined = 'fake-a';
  let time = 0;
  const calls: RequestInit[] = [];
  const port = createProviderUsagePort({ getKey: () => key, now: () => time, fetch: async (url, init) => {
    expect(url).toBe('https://api.deepseek.com/user/balance');
    calls.push(init);
    return Response.json(balance);
  } });
  await Promise.all([port.read('deepseek'), port.read('deepseek')]);
  await port.read('deepseek');
  expect(calls).toHaveLength(1);
  expect(calls[0]?.redirect).toBe('error');
  time = 30_001;
  await port.read('deepseek');
  expect(calls).toHaveLength(2);
  key = 'fake-b';
  await port.read('deepseek');
  expect(calls).toHaveLength(3);
  expect(new Headers(calls[2]?.headers).get('Authorization')).toBe('Bearer fake-b');
  key = undefined;
  expect((await port.read('deepseek')).unavailable?.reason).toBe('notConfigured');
  expect(calls).toHaveLength(3);
});

test('old in-flight credential generation cannot publish or overwrite current usage', async () => {
  let key = 'fake-a';
  let finish!: (response: Response) => void;
  const port = createProviderUsagePort({ getKey: () => key, fetch: async (_url, init) => {
    if (new Headers(init.headers).get('Authorization') === 'Bearer fake-a') return new Promise(resolve => { finish = resolve; });
    return Response.json(balance);
  } });
  const old = port.read('deepseek');
  key = 'fake-b';
  const current = await port.read('deepseek');
  finish(Response.json(balance));
  expect((await old).unavailable?.reason).toBe('probeFailed');
  expect(await port.read('deepseek')).toEqual(current);
});

test('failures are redacted and retried, not cached', async () => {
  let calls = 0;
  const port = createProviderUsagePort({ getKey: () => 'secret', fetch: async () => {
    calls++;
    if (calls === 1) throw new Error('secret');
    return Response.json(balance);
  } });
  const failed = await port.read('deepseek');
  expect(failed.unavailable?.reason).toBe('probeFailed');
  expect(JSON.stringify(failed)).not.toContain('secret');
  expect((await port.read('deepseek')).balances).toHaveLength(1);
});

test('MiniMax falls back only within its configured host and uses one deadline', async () => {
  const urls: string[] = [];
  const signals: unknown[] = [];
  const port = createProviderUsagePort({ getKey: () => 'fake', fetch: async (url, init) => {
    urls.push(url);
    signals.push(init.signal);
    return urls.length === 1 ? new Response('', { status: 404 }) : Response.json(minimax);
  } });
  expect((await port.read('minimax')).windows).toHaveLength(2);
  expect(urls).toEqual(['https://api.minimax.io/v1/token_plan/remains', 'https://api.minimax.io/v1/api/openplatform/coding_plan/remains']);
  expect(signals[0]).toBe(signals[1]);
});

test('stalled fetch aborts and returns unavailable', async () => {
  const port = createProviderUsagePort({ getKey: () => 'fake', timeoutMs: 5, fetch: async (_url, init) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  expect((await port.read('deepseek')).unavailable?.reason).toBe('probeFailed');
});
