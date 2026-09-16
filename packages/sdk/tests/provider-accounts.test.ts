import { afterEach, expect, spyOn, test } from 'bun:test';
import { HttpClient } from '../src/transport/http';
import { ProvidersRestNamespace } from '../src/rest/providers';

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | undefined;
afterEach(() => { fetchSpy?.mockRestore(); });

test('account operations encode IDs, forward cancellation and return status', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({ status: { provider: 'codex', connected: true, activeAccountId: 'account/one' } });
  });
  const providers = new ProvidersRestNamespace(new HttpClient({ url: 'https://test.invalid', token: 'test-token' }));
  const controller = new AbortController();
  const result = await providers.activateAccount('codex', 'account/one', { signal: controller.signal });
  await providers.removeAccount('codex', 'account/one', { signal: controller.signal });
  expect(result.status.activeAccountId).toBe('account/one');
  expect(calls.map(call => call.url)).toEqual([
    'https://test.invalid/api/providers/codex/accounts/account%2Fone/activate',
    'https://test.invalid/api/providers/codex/accounts/account%2Fone',
  ]);
  expect(calls.map(call => call.init?.method)).toEqual(['POST', 'DELETE']);
  expect(calls.every(call => call.init?.signal === controller.signal)).toBe(true);
  expect(new Headers(calls[0].init?.headers).get('authorization')).toBe('Bearer test-token');
});
