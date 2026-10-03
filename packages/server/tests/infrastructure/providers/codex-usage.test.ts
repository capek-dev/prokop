import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexAccountStore } from '@/infrastructure/providers/codex-accounts';
import { CodexAccountRuntime } from '@/infrastructure/providers/codex-account-runtime';
import { createCodexAccountUsagePort, parseCodexAccountUsage } from '@/infrastructure/providers/codex-usage';

const window = { used_percent: 25, limit_window_seconds: 18000, reset_at: 1800000000 };
const payload = { plan_type: 'plus', rate_limit: { primary_window: window,
  secondary_window: { ...window, used_percent: 75, limit_window_seconds: 604800 } } };
function tokens(id: string, expires = 3600) {
  return { access_token: `access-${id}`, refresh_token: `refresh-${id}`, expires_in: expires,
    id_token: `header.${Buffer.from(JSON.stringify({ sub: id, email: `${id}@example.com`, chatgpt_account_id: id })).toString('base64url')}.sig` };
}
function fakeFetch(send: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>): typeof fetch {
  return Object.assign(send, { preconnect: globalThis.fetch.preconnect });
}
let dir: string;
let store: CodexAccountStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'codex-usage-'));
  store = new CodexAccountStore(() => join(dir, 'codex.json'));
  store.add(tokens('a'));
  store.add(tokens('b'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('parses primary, weekly, review and additional windows without fabricating missing usage', () => {
  const result = parseCodexAccountUsage('local', { ...payload,
    code_review_rate_limit: { primary_window: window },
    additional_rate_limits: [{ limit_name: 'Extra model', rate_limit: { primary_window: window } }],
  }, 0);
  expect(result.windows.map(w => w.label)).toEqual(['5-hour', 'Weekly', 'Code review · 5-hour', 'Extra model · 5-hour']);
  expect(result.windows[0]).toMatchObject({ usedPercent: 25, resetsAt: new Date(1800000000000).toISOString() });
  expect(result.accountId).toBe('local');
  expect(parseCodexAccountUsage('local', {}, 0).unavailable?.reason).toBe('unsupported');
  for (const used_percent of [null, '', true, -1, 101, Infinity]) {
    expect(() => parseCodexAccountUsage('local', { rate_limit: { primary_window: { ...window, used_percent } } }, 0)).toThrow();
  }
});

test('pins all accounts independently of selection, shares reads, expires cache and rejects redirects', async () => {
  const seen: string[] = [];
  let now = 0;
  const runtime = new CodexAccountRuntime(store, async () => { throw new Error('Unexpected refresh'); }, fakeFetch(async (input, init) => {
    expect(String(input)).toBe('https://chatgpt.com/backend-api/wham/usage');
    expect(init?.redirect).toBe('error');
    const headers = new Headers(init?.headers);
    const id = headers.get('ChatGPT-Account-Id')!;
    expect(headers.get('authorization')).toBe(`Bearer access-${id}`);
    seen.push(id);
    return Response.json(payload);
  }));
  const usage = createCodexAccountUsagePort({ accounts: store, runtime, now: () => now });
  const [a, b] = store.status().accounts!;
  await Promise.all([usage.read(a.id), usage.read(a.id), usage.read(b.id)]);
  expect(seen).toEqual(['a', 'b']);
  expect(store.status().activeAccountId).toBe(a.id);
  store.activate(b.id);
  await usage.read(a.id);
  expect(seen).toHaveLength(2);
  now = 30001;
  await usage.read(a.id);
  expect(seen).toHaveLength(3);
  store.remove(b.id);
  expect(store.status().activeAccountId).toBeNull();
  expect((await usage.read(a.id)).windows).toHaveLength(2);
  expect((await usage.read(b.id)).unavailable?.reason).toBe('notConnected');
});

test('401 refresh retries the requested inactive account, never the selected account', async () => {
  const [a, b] = store.status().accounts!;
  const seen: string[] = [];
  const refreshed: string[] = [];
  const runtime = new CodexAccountRuntime(store, async token => {
    refreshed.push(token);
    return { ...tokens('b'), access_token: 'new-b' };
  }, fakeFetch(async (_input, init) => {
    const headers = new Headers(init?.headers);
    expect(headers.get('ChatGPT-Account-Id')).toBe('b');
    seen.push(headers.get('authorization')!);
    return seen.length === 1 ? new Response('', { status: 401 }) : Response.json(payload);
  }));
  const usage = createCodexAccountUsagePort({ accounts: store, runtime });
  expect((await usage.read(b.id)).windows).toHaveLength(2);
  expect(refreshed).toEqual(['refresh-b']);
  expect(seen).toEqual(['Bearer access-b', 'Bearer new-b']);
  expect(store.status().activeAccountId).toBe(a.id);
});

test.each(['remove', 'reconnect'] as const)('discards late snapshots after %s', async action => {
  let resolve!: (response: Response) => void;
  let started!: () => void;
  const ready = new Promise<void>(r => { started = r; });
  let count = 0;
  const runtime = new CodexAccountRuntime(store, async () => tokens('a'), fakeFetch(async () => {
    count++;
    if (count > 1) return Response.json(payload);
    started();
    return new Promise<Response>(r => { resolve = r; });
  }));
  const usage = createCodexAccountUsagePort({ accounts: store, runtime });
  const id = store.get()!.id;
  const pending = usage.read(id);
  await ready;
  if (action === 'remove') store.remove(id);
  else store.add(tokens('a'));
  resolve(Response.json(payload));
  expect((await pending).unavailable?.reason).toBe('notConnected');
  if (action === 'reconnect') expect((await usage.read(id)).windows).toHaveLength(2);
});

test('errors are redacted and not cached; reauthentication never displays cached usage', async () => {
  let count = 0;
  const runtime = new CodexAccountRuntime(store, async () => tokens('a'), fakeFetch(async () => {
    if (++count === 1) throw new Error('secret access-a refresh-a');
    return Response.json(payload);
  }));
  const usage = createCodexAccountUsagePort({ accounts: store, runtime });
  const account = store.get()!;
  const failed = await usage.read(account.id);
  expect(failed.unavailable?.reason).toBe('probeFailed');
  expect(JSON.stringify(failed)).not.toContain('access-a');
  expect(JSON.stringify(failed)).not.toContain('refresh-a');
  expect((await usage.read(account.id)).windows).toHaveLength(2);
  store.updateCredentials(account, account.config, true);
  expect((await usage.read(account.id)).unavailable?.reason).toBe('reauthRequired');
  expect(count).toBe(2);
});

test('deadline includes token refresh and prevents requests after timeout', async () => {
  store.add(tokens('a', -1));
  let resolve!: (value: ReturnType<typeof tokens>) => void;
  let sends = 0;
  const runtime = new CodexAccountRuntime(store, () => new Promise(r => { resolve = r; }), fakeFetch(async () => {
    sends++;
    return Response.json(payload);
  }));
  const usage = createCodexAccountUsagePort({ accounts: store, runtime, timeoutMs: 5 });
  expect((await usage.read(store.get()!.id)).unavailable?.reason).toBe('probeFailed');
  resolve(tokens('a'));
  await new Promise(r => setTimeout(r, 5));
  expect(sends).toBe(0);
});

test('deadline aborts an upstream fetch', async () => {
  let signal: AbortSignal | undefined;
  const runtime = new CodexAccountRuntime(store, async () => tokens('a'), fakeFetch(async (_input, init) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted'))));
  }));
  const usage = createCodexAccountUsagePort({ accounts: store, runtime, timeoutMs: 5 });
  expect((await usage.read(store.get()!.id)).unavailable?.reason).toBe('probeFailed');
  expect(signal?.aborted).toBe(true);
});
