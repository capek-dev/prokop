import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createPullRequestsApplication } from '@/application/pull-requests';
import type { PullRequestProviderPort, PullRequestsPort } from '@/application/ports/pull-requests';
import { BadRequestError, HttpError } from '@/application/http-errors';
import { registerPullRequestRoutes } from '@/transport/http/routes/pull-requests';
import { parsePullRequestRemote } from '@/infrastructure/pull-requests/repositories';
import type { PullRequestSummary } from '@prokopai/sdk/types';

const repo = parsePullRequestRemote('origin', 'git@github.com:acme/project.git')!;
const scope = { remote: 'origin', repositoryKey: repo.key, root: '/worktree' };
const head = 'a'.repeat(40);
const pr: PullRequestSummary = {
  number: 7,
  title: 'Test',
  body: '',
  url: `${repo.url}/pull/7`,
  author: { id: '1', name: 'Alice' },
  state: 'open',
  draft: false,
  sourceBranch: 'feature',
  targetBranch: 'main',
  head,
  base: 'b'.repeat(40),
  updatedAt: '2026-10-08',
};
function fixture() {
  const events: string[] = [];
  const roots: string[] = [];
  let writes = 0;
  const provider: PullRequestProviderPort = {
    account: async () => ({ id: '1', name: 'Alice' }),
    list: async () => ({ items: [pr], nextPage: null }),
    summary: async () => pr,
    detail: async () => ({
      ...pr,
      comments: [],
      threads: [],
      checks: [],
      reviewers: [],
      warnings: [],
      mergeMethods: ['squash'],
      mergeability: 'mergeable',
    }),
    files: async () => ({ files: [], nextPage: null, head }),
    patch: async () => ({ patch: '' }),
    create: async () => {
      writes++;
      return pr;
    },
    action: async () => {
      writes++;
    },
  };
  const port: PullRequestsPort = {
    resolveRoot: (_id, root) => {
      if (root !== '/worktree') throw new BadRequestError('Unavailable root');
      return root;
    },
    repositories: async (root) => {
      roots.push(root);
      return { repositories: [repo], branch: 'feature' };
    },
    provider: () => provider,
    changed: (id, key) => events.push(`${id}:${key}`),
  };
  return {
    service: createPullRequestsApplication(port),
    provider,
    port,
    events,
    roots,
    writes: () => writes,
  };
}
test('uses the selected checkout and verifies repository/account identity before writing', async () => {
  const f = fixture();
  await f.service.action('ws', scope, 7, {
    action: 'comment',
    body: 'Review',
    expectedHead: head,
    accountId: '1',
  });
  expect(f.roots).toEqual(['/worktree']);
  expect(f.writes()).toBe(1);
  expect(f.events).toEqual([`ws:${repo.key}`]);
  await expect(
    f.service.action('ws', { ...scope, repositoryKey: 'github:other/repo' }, 7, {
      action: 'close',
      expectedHead: head,
      accountId: '1',
    }),
  ).rejects.toThrow('remote changed');
  await expect(
    f.service.action('ws', scope, 7, { action: 'close', expectedHead: head, accountId: '2' }),
  ).rejects.toThrow('account changed');
  expect(f.writes()).toBe(1);
});
test('unavailable managed root never falls back to the primary repository', async () => {
  const f = fixture();
  await expect(f.service.list('ws', { ...scope, root: '/missing' }, 'open', 1)).rejects.toThrow(
    'Unavailable root',
  );
  expect(f.roots).toEqual([]);
});
test('concurrent writes are refused, and uncertain outcomes still refresh every client', async () => {
  const f = fixture();
  let release!: () => void;
  f.provider.action = async () => {
    await new Promise<void>((r) => {
      release = r;
    });
    throw new BadRequestError('Timed out after posting');
  };
  const action = f.service.action('ws', scope, 7, { action: 'close', expectedHead: head, accountId: '1' });
  // Wait for the injected operation to enter, without timers or provider calls.
  for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
  await expect(
    f.service.action('ws', scope, 7, { action: 'close', expectedHead: head, accountId: '1' }),
  ).rejects.toThrow('in progress');
  release();
  await expect(action).rejects.toThrow('Timed out');
  expect(f.events).toHaveLength(1);
  f.provider.action = async () => {};
  await f.service.action('ws', scope, 7, { action: 'close', expectedHead: head, accountId: '1' });
  expect(f.events).toHaveLength(2);
});
test('a CLI account switch during a read cannot populate another account cache', async () => {
  const f = fixture();
  let reads = 0;
  f.provider.account = async () => ({ id: String(++reads), name: 'Changed' });
  await expect(f.service.detail('ws', scope, 7)).rejects.toThrow('account changed');
});
test('discovery explains provider failures without returning arbitrary thrown text', async () => {
  const f = fixture();
  f.provider.account = async () => {
    throw new Error('token=secret');
  };
  const result = await f.service.discover('ws', '/worktree');
  expect(result.connections[0].status).toBe('unavailable');
  expect(JSON.stringify(result)).not.toContain('secret');
});
test('discovery returns the setup command attached to a sign-in failure', async () => {
  const f = fixture();
  f.provider.account = async () => {
    throw new BadRequestError('Azure CLI needs a sign-in.', { command: 'az login --tenant t' });
  };
  const result = await f.service.discover('ws', '/worktree');
  expect(result.connections[0]).toMatchObject({
    status: 'unavailable',
    message: 'Azure CLI needs a sign-in.',
    command: 'az login --tenant t',
  });
});
test('routes reject malformed mutations before reaching a provider', async () => {
  const f = fixture();
  const app = new Hono();
  app.onError((error, c) => c.json({ error: error.message }, error instanceof HttpError ? 400 : 500));
  registerPullRequestRoutes(app, f.service);
  const response = await app.request('/api/workspaces/ws/pull-requests/7/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...scope,
      action: 'merge',
      method: 'squash',
      expectedHead: head,
      accountId: '1',
      bypassPolicy: true,
    }),
  });
  expect(response.status).toBe(400);
  expect(f.writes()).toBe(0);
  expect(f.roots).toEqual([]);
  const good = await app.request('/api/workspaces/ws/pull-requests/7/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...scope,
      action: 'comment',
      body: 'Feedback',
      expectedHead: head,
      accountId: '1',
    }),
  });
  expect(good.status).toBe(200);
  expect(f.writes()).toBe(1);
});
