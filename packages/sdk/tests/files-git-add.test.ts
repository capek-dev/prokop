import { afterEach, expect, mock, test } from 'bun:test';
import { FilesRestNamespace } from '../src/rest/files';
import { HttpClient } from '../src/transport/http';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('Git add sends a literal path and selected root to the encoded workspace endpoint', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit = {};
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init ?? {};
    return Response.json({ path: '[new].txt' });
  }) as typeof fetch;
  const files = new FilesRestNamespace(new HttpClient({ url: 'https://example.com' }));
  const result = await files.gitAdd('ws/1', '[new].txt', { root: '/worktree' });
  expect(capturedUrl).toBe('https://example.com/api/workspaces/ws%2F1/git/add');
  expect(capturedInit.method).toBe('POST');
  expect(JSON.parse(capturedInit.body as string)).toEqual({ path: '[new].txt', root: '/worktree' });
  expect(result).toEqual({ path: '[new].txt' });
});
