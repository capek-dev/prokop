import { afterEach, expect, mock, test } from 'bun:test';
import { FilesRestNamespace } from '../src/rest/files';
import { HttpClient } from '../src/transport/http';
import { TypedEventEmitter } from '../src/emitter';
import { routeServerMessage, type SdkEventMap } from '../src/types/server-messages';

test('Git completion routes to SDK subscribers', () => {
  const emitter = new TypedEventEmitter<SdkEventMap>();
  const handler = mock(() => {});
  emitter.on('git.changed', handler);
  routeServerMessage(emitter, { type: 'git.changed', workspaceId: 'ws', root: '/tree' });
  expect(handler).toHaveBeenCalledWith('ws', '/tree');
});

test('Rebase SDK forwards tokens, local tips and root', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body as string) : null });
    return Response.json({ active: false });
  }) as typeof fetch;
  const files = new FilesRestNamespace(new HttpClient({ url: 'https://example.com' }));
  const start = { root: '/tree', expectedBranch: 'feature', expectedHead: 'a'.repeat(40), baseBranch: 'main', baseHead: 'b'.repeat(40) };
  const control = { root: '/tree', action: 'abort' as const, token: 'c'.repeat(64) };
  const resolution = { root: '/tree', path: 'file', token: 'c'.repeat(64), resolution: 'text' as const, text: '' };
  await files.gitRebaseState('ws/1', { root: '/tree' });
  await files.gitRebaseStart('ws/1', start);
  await files.gitRebaseControl('ws/1', control);
  await files.gitRebaseResolve('ws/1', resolution);
  await files.gitRebaseConflict('ws/1', { root: '/tree', path: 'file' });
  expect(calls[0].url).toBe('https://example.com/api/workspaces/ws%2F1/git/rebase?root=%2Ftree');
  expect(calls.slice(1).map((call) => call.body)).toEqual([start, control, resolution, { root: '/tree', path: 'file' }]);
});

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
test('Git operations send encoded workspace, selected paths, root and explicit lease', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json({ head: 'a'.repeat(40) });
  }) as typeof fetch;
  const files = new FilesRestNamespace(new HttpClient({ url: 'https://example.com' }));
  const input = { root: '/worktree', paths: ['literal[1]', 'line\nbreak'], message: 'Files', expectedHead: null, expectedBranch: 'main' };
  await files.gitCommit('ws/1', input);
  expect(calls[0].url).toBe('https://example.com/api/workspaces/ws%2F1/git/commit');
  expect(JSON.parse(calls[0].init!.body as string)).toEqual(input);
  const push = { root: '/worktree', remote: 'origin', branch: 'main', expectedBranch: 'main', expectedHead: 'a'.repeat(40), force: true, expectedRemoteHead: 'b'.repeat(40) };
  await files.gitPush('ws/1', push);
  expect(JSON.parse(calls[1].init!.body as string)).toEqual(push);
  await files.gitPushPreview('ws/1', { root: '/worktree', remote: 'origin', branch: 'main' });
  expect(calls[2].url).toEndWith('/git/push-preview');
  await files.gitRepository('ws/1', { root: '/worktree' });
  expect(calls[3].url).toEndWith('/git/repository?root=%2Fworktree');
});
