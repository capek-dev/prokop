import { expect, test } from 'bun:test';
import { PullRequestsRestNamespace } from '../src/rest/pull-requests';
import type { HttpClient } from '../src/transport/http';

test('main-checkout reads omit undefined root instead of sending root=undefined', async () => {
  const params: URLSearchParams[] = [];
  const http = {
    get: async (_path: string, options: { params: Record<string, string> }) => {
      params.push(new URLSearchParams(options.params));
      return {};
    },
  } as unknown as HttpClient;
  const api = new PullRequestsRestNamespace(http);
  const scope = { remote: 'origin', repositoryKey: 'github:acme/project', root: undefined };
  await api.discover('ws');
  await api.list('ws', scope);
  await api.detail('ws', scope, 7);
  await api.files('ws', scope, 7, 'a'.repeat(40));
  await api.patch('ws', scope, 7, 'a'.repeat(40), 'src/app.ts');
  expect(params).toHaveLength(5);
  for (const query of params) expect(query.has('root')).toBe(false);
});

test('PR requests carry the selected root, remote, account, and reviewed SHA', async () => {
  const calls: { method: string; path: string; input: unknown }[] = [];
  const http = {
    get: async (path: string, input: unknown) => {
      calls.push({ method: 'get', path, input });
      return {};
    },
    post: async (path: string, input: unknown) => {
      calls.push({ method: 'post', path, input });
      return {};
    },
  } as unknown as HttpClient;
  const api = new PullRequestsRestNamespace(http);
  const scope = { root: '/worktree', remote: 'upstream', repositoryKey: 'github:acme/project' };
  await api.files('ws/1', scope, 7, 'a'.repeat(40), 2);
  expect(calls[0]).toEqual({
    method: 'get',
    path: '/workspaces/ws%2F1/pull-requests/7/files',
    input: { params: { ...scope, head: 'a'.repeat(40), page: '2' } },
  });
  const action = {
    action: 'merge' as const,
    method: 'squash' as const,
    accountId: 'user',
    expectedHead: 'a'.repeat(40),
  };
  await api.action('ws/1', scope, 7, action);
  expect(calls[1]).toEqual({
    method: 'post',
    path: '/workspaces/ws%2F1/pull-requests/7/actions',
    input: { ...scope, ...action },
  });
});
