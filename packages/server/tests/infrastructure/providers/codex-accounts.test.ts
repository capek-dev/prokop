import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderAccountStatus } from '@prokopai/sdk';
import { buildCodexConfig, OAuthTokenRefreshError, type OAuthTokenSet } from '@/domains/provider-accounts/oauth';
import { CodexAccountStore } from '@/infrastructure/providers/codex-accounts';
import { CodexAccountRuntime } from '@/infrastructure/providers/codex-account-runtime';

function tokens(id: string, expires = 3600): OAuthTokenSet {
  return {
    access_token: `access-${id}`, refresh_token: `refresh-${id}`, expires_in: expires,
    id_token: `header.${Buffer.from(JSON.stringify({ sub: `user-${id}`, email: `${id}@example.com`, chatgpt_account_id: id })).toString('base64url')}.sig`,
  };
}

function fakeFetch(send: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>): typeof fetch {
  return Object.assign(send, { preconnect: globalThis.fetch.preconnect });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe('Codex accounts and pinned requests', () => {
  let dir: string;
  let path: string;
  let store: CodexAccountStore;
  let events: ProviderAccountStatus[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'codex-accounts-'));
    path = join(dir, 'codex.json');
    events = [];
    store = new CodexAccountStore(() => path, status => events.push(status));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('preserves legacy bytes until mutation, then migrates credentials and selection atomically', () => {
    const legacy = buildCodexConfig(tokens('a'), Date.now());
    const bytes = JSON.stringify(legacy);
    writeFileSync(path, bytes);
    expect(store.status().activeAccountId).toBe('legacy');
    expect(readFileSync(path, 'utf8')).toBe(bytes);
    store.add(tokens('b'));
    expect(store.get()?.config).toEqual(legacy);
    expect(store.status().accounts).toHaveLength(2);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(new CodexAccountStore(() => path).get()?.config).toEqual(legacy);
  });

  test('adds, reconnects, switches and removes without exposing credentials or implicit fallback', () => {
    store.add(tokens('a'));
    const a = store.get()!;
    store.add(tokens('b'));
    const b = store.status().accounts![1].id;
    expect(store.get()?.id).toBe(a.id);
    store.add(tokens('a'));
    expect(store.status().accounts).toHaveLength(2);
    expect(store.get()?.connectionId).not.toBe(a.connectionId);
    store.activate(b);
    expect(store.get()?.config.accountId).toBe('b');
    store.remove(a.id);
    expect(store.get()?.id).toBe(b);
    store.remove(b);
    expect(store.status()).toMatchObject({ connected: false, activeAccountId: null, accounts: [] });
    const wire = JSON.stringify(events);
    expect(wire).not.toContain('access-');
    expect(wire).not.toContain('refresh-');
    expect(wire).not.toContain('id_token');
    expect(events).toHaveLength(6);
  });

  test('removing the active account leaves other accounts stored but unselected', () => {
    store.add(tokens('a'));
    const a = store.get()!;
    store.add(tokens('b'));
    store.remove(a.id);
    expect(store.status()).toMatchObject({ activeAccountId: null, connected: false });
    expect(store.status().accounts).toHaveLength(1);
    store.disconnect();
    expect(store.status().accounts).toEqual([]);
  });

  test('rejects malformed persistence and unknown IDs without changing bytes', () => {
    writeFileSync(path, '{"version":99}');
    expect(() => store.add(tokens('a'))).toThrow('Invalid Codex');
    expect(readFileSync(path, 'utf8')).toBe('{"version":99}');
    writeFileSync(path, JSON.stringify({ version: 1, activeAccountId: null, accounts: [] }));
    const before = readFileSync(path, 'utf8');
    expect(() => store.activate('../unknown')).toThrow('not found');
    expect(() => store.remove('missing')).toThrow('not found');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  test('unknown identities get separate local IDs rather than overwriting accounts', () => {
    store.add({ access_token: 'a', refresh_token: 'a' });
    store.add({ access_token: 'b', refresh_token: 'b' });
    expect(store.status().accounts).toHaveLength(2);
    expect(store.status().accounts!.map(a => a.label)).toEqual(['Account 1', 'Account 2']);
  });

  test('switch during 401 keeps token and account header paired; a new model uses the new selection', async () => {
    store.add(tokens('a'));
    store.add(tokens('b'));
    const b = store.status().accounts![1].id;
    const sent: string[][] = [];
    const refreshed: string[] = [];
    const runtime = new CodexAccountRuntime(store, async token => {
      refreshed.push(token);
      return { ...tokens('a'), access_token: 'renewed-a' };
    }, fakeFetch(async (_input, init) => {
      const headers = new Headers(init?.headers);
      sent.push([headers.get('authorization')!, headers.get('ChatGPT-Account-Id')!]);
      if (sent.length === 1) {
        store.activate(b);
        return new Response('', { status: 401 });
      }
      return new Response('ok');
    }));
    const fetchA = await runtime.createFetch();
    await fetchA('https://api.openai.com/v1/responses');
    const fetchB = await runtime.createFetch();
    await fetchB('https://api.openai.com/v1/responses');
    expect(sent).toEqual([['Bearer access-a', 'a'], ['Bearer renewed-a', 'a'], ['Bearer access-b', 'b']]);
    expect(refreshed).toEqual(['refresh-a']);
  });

  test('concurrent expiry refresh is single-flight and preserves selection changes', async () => {
    store.add(tokens('a', -1));
    store.add(tokens('b'));
    const pending = deferred<OAuthTokenSet>();
    let calls = 0;
    const runtime = new CodexAccountRuntime(store, () => { calls++; return pending.promise; });
    const one = runtime.createFetch();
    const two = runtime.createFetch();
    const b = store.status().accounts![1].id;
    store.activate(b);
    pending.resolve(tokens('a'));
    await Promise.all([one, two]);
    expect(calls).toBe(1);
    expect(store.get()?.id).toBe(b);
    expect(store.status().accounts).toHaveLength(2);
  });

  test.each(['remove', 'reconnect'] as const)('late refresh cannot overwrite %s', async action => {
    store.add(tokens('a', -1));
    const a = store.get()!;
    const pending = deferred<OAuthTokenSet>();
    const runtime = new CodexAccountRuntime(store, () => pending.promise);
    const request = runtime.createFetch();
    if (action === 'remove') store.remove(a.id);
    else store.add({ ...tokens('a'), access_token: 'new-login' });
    pending.resolve(tokens('a'));
    await expect(request).rejects.toThrow('changed while refreshing');
    expect(store.get()?.config.access).toBe(action === 'remove' ? undefined : 'new-login');
  });

  test('replays Request bodies once on 401 and never rotates accounts on rate limits', async () => {
    store.add(tokens('a'));
    store.add(tokens('b'));
    const bodies: string[] = [];
    let calls = 0;
    const runtime = new CodexAccountRuntime(store, async () => tokens('a'), fakeFetch(async (_input, init) => {
      calls++;
      bodies.push(await new Response(init?.body).text());
      return new Response('', { status: calls <= 2 ? 401 : 429 });
    }));
    const fetch = await runtime.createFetch();
    const request = new Request('https://api.openai.com/v1/responses', { method: 'POST', body: '{"prompt":"hello"}' });
    expect((await fetch(request)).status).toBe(401);
    expect(calls).toBe(2);
    expect(bodies).toEqual(['{"prompt":"hello"}', '{"prompt":"hello"}']);
    expect((await fetch('https://api.openai.com/v1/responses')).status).toBe(429);
    expect(calls).toBe(3);
    expect(store.get()?.config.accountId).toBe('a');
  });

  test('cancellation during refresh prevents the retry without cancelling a shared refresh', async () => {
    store.add(tokens('a'));
    const controller = new AbortController();
    let calls = 0;
    const runtime = new CodexAccountRuntime(store, async () => {
      controller.abort(new Error('cancelled'));
      return tokens('a');
    }, fakeFetch(async () => { calls++; return new Response('', { status: 401 }); }));
    const fetch = await runtime.createFetch();
    await expect(fetch('https://api.openai.com/v1/responses', { signal: controller.signal })).rejects.toThrow('cancelled');
    expect(calls).toBe(1);
    expect(store.status().connected).toBe(true);
  });

  test('a changed upstream identity during refresh requires reconnect, never sends mismatched headers', async () => {
    store.add(tokens('a', -1));
    const runtime = new CodexAccountRuntime(store, async () => tokens('b'));
    await expect(runtime.createFetch()).rejects.toThrow('changed account identity');
    expect(store.get()?.config.accountId).toBe('a');
    expect(store.get()?.reauthRequired).toBe(true);
  });

  test('transient failure preserves credentials; invalid grant marks only the failed account', async () => {
    store.add(tokens('a', -1));
    store.add(tokens('b'));
    const a = store.get()!;
    const b = store.status().accounts![1].id;
    const transient = new CodexAccountRuntime(store, async () => { throw new Error('network unavailable'); });
    await expect(transient.createFetch()).rejects.toThrow('network unavailable');
    expect(store.get()?.config.refresh).toBe(a.config.refresh);
    expect(store.get()?.reauthRequired).toBe(false);
    const invalid = new CodexAccountRuntime(store, async () => {
      throw new OAuthTokenRefreshError({ providerId: 'codex', status: 400, code: 'invalid_grant' });
    });
    await expect(invalid.createFetch()).rejects.toThrow('invalid_grant');
    expect(store.get()?.reauthRequired).toBe(true);
    expect(store.get(b)?.reauthRequired).toBe(false);
    expect(store.status().activeAccountId).toBe(a.id);
  });
});
