import { afterEach, expect, mock, test } from 'bun:test';
import { SessionsRestNamespace } from '../src/rest/sessions';
import { SessionsNamespace } from '../src/namespaces/sessions';
import { HttpClient } from '../src/transport/http';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('fetches the host-wide Codex catalog without requiring a session', async () => {
  const urls: string[] = [];
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    urls.push(new URL(String(url)).pathname);
    return Response.json({ models: [] });
  }) as typeof fetch;
  const sessions = new SessionsRestNamespace(new HttpClient({ url: 'https://example.com' }));
  expect(await sessions.codexCatalog()).toEqual({ models: [] });
  expect(urls).toEqual(['/api/harnesses/codex-cli/models']);
});

test('keeps the harness discriminator in model selections with overlapping IDs', () => {
  const sent: unknown[] = [];
  const sessions = new SessionsNamespace(message => sent.push(message));
  sessions.selectHarnessModel('session', { harness: 'codex-cli', modelId: 'shared', effort: 'high' });
  sessions.selectHarnessModel('session', { harness: 'prokop', modelId: 'shared', providerId: 'provider' });
  expect(sent).toEqual([
    { type: 'session.select_harness_model', sessionId: 'session', choice: { harness: 'codex-cli', modelId: 'shared', effort: 'high' } },
    { type: 'session.select_harness_model', sessionId: 'session', choice: { harness: 'prokop', modelId: 'shared', providerId: 'provider' } },
  ]);
});
