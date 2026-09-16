import { afterEach, expect, mock, test } from 'bun:test';
import { SessionsRestNamespace } from '../src/rest/sessions';
import { HttpClient } from '../src/transport/http';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('serializes category filters and fetches counts without list rows', async () => {
  const urls: URL[] = [];
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    urls.push(new URL(String(url)));
    return Response.json({ counts: { active: 1, archived: 2, scheduled: 3 } });
  }) as typeof fetch;
  const sessions = new SessionsRestNamespace(new HttpClient({ url: 'https://example.com' }));
  await sessions.listByWorkspace({ workspaceId: 'ws/one', category: 'archived', limit: 100, cursor: 'next' });
  await sessions.listGrouped({ workspaceIds: ['one', 'two'], category: 'active', limitPerWorkspace: 50 });
  const response = await sessions.countsByWorkspace('ws/one');
  expect(urls[0].pathname).toBe('/api/workspaces/ws%2Fone/sessions');
  expect(urls[0].searchParams.get('category')).toBe('archived');
  expect(urls[0].searchParams.get('cursor')).toBe('next');
  expect(urls[1].searchParams.get('category')).toBe('active');
  expect(urls[2].pathname).toBe('/api/workspaces/ws%2Fone/sessions/counts');
  expect(response.counts).toEqual({ active: 1, archived: 2, scheduled: 3 });
});
