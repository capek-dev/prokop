import { afterEach, expect, test } from 'vitest';
import type { GitStatusResponse } from '@prokopai/sdk';
import { queryClient } from '@/components/providers/QueryProvider';
import { handleGitChanged, handleGitStatus, newerGitStatus, resetGitStatusHeadsForTest } from '@/handlers/serverMessage/gitHandlers';
import { queryKeys } from '@/lib/queryKeys';

afterEach(() => {
  queryClient.clear();
  resetGitStatusHeadsForTest();
});

function status(revision: number, overrides: Partial<GitStatusResponse> = {}): GitStatusResponse {
  return { availability: { available: true, root: '/repo' }, files: [], root: '/repo', revision,
    head: { oid: 'a1', branch: 'main' }, ...overrides };
}

const refKeys = (workspaceId: string) => [
  ['git-repository', 'server', workspaceId, '/repo'],
  ['git-branches', 'server', workspaceId, '/repo'],
  ['git-history', 'server', workspaceId, '/repo', 'a1', null],
  ['git-rebase', 'server', workspaceId, '/repo'],
];

function seed(keys: unknown[][]): void {
  for (const key of keys) queryClient.setQueryData(key, {});
}

const invalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

test('Git changes invalidate cached history across roots and upstreams', () => {
  const keys = [
    ['git-history', 'server', 'ws', '/tree', 'head', 'refs/remotes/origin/main'],
    ['git-history', 'server', 'ws', '/linked', 'head', null],
  ];
  for (const key of keys) queryClient.setQueryData(key, { pages: [], pageParams: [0] });
  queryClient.setQueryData(['unrelated'], {});

  handleGitChanged('ws');

  for (const key of keys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(['unrelated'])?.isInvalidated).toBe(false);
});

test('Git changes leave other workspaces alone', () => {
  seed([...refKeys('ws'), ...refKeys('other')]);

  handleGitChanged('ws');

  for (const key of refKeys('ws')) expect(invalidated(key)).toBe(true);
  for (const key of refKeys('other')) expect(invalidated(key)).toBe(false);
});

test('pushed status replaces matching roots and ignores older revisions', () => {
  const main = queryKeys.files.gitStatus('ws', undefined);
  const linked = queryKeys.files.gitStatus('ws', '/linked');
  queryClient.setQueryData(main, status(5));
  queryClient.setQueryData(linked, status(5, { root: '/linked' }));

  handleGitStatus('ws', '/repo', status(7, { files: [{ path: 'a.ts', git: { status: 'modified', staged: false, unstaged: true } }] }));
  expect(queryClient.getQueryData<GitStatusResponse>(main)?.files.map(f => f.path)).toEqual(['a.ts']);
  expect(queryClient.getQueryData<GitStatusResponse>(linked)?.revision).toBe(5);

  handleGitStatus('ws', '/repo', status(6));
  expect(queryClient.getQueryData<GitStatusResponse>(main)?.revision).toBe(7);
});

test('HTTP and pushed snapshots keep the newer revision', () => {
  expect(newerGitStatus(status(9), status(8)).revision).toBe(9);
  expect(newerGitStatus(status(8), status(9)).revision).toBe(9);
  expect(newerGitStatus(undefined, status(1)).revision).toBe(1);
  expect(newerGitStatus(status(9, { root: '/other' }), status(1)).revision).toBe(1);
});

test('branch views refresh only when HEAD moves, scoped to the workspace', () => {
  seed([...refKeys('ws'), ...refKeys('other')]);

  // The first snapshot only records HEAD.
  handleGitStatus('ws', '/repo', status(1));
  for (const key of refKeys('ws')) expect(invalidated(key)).toBe(false);

  // Working-tree changes with the same HEAD do not touch branch views.
  handleGitStatus('ws', '/repo', status(2, { files: [{ path: 'a.ts', git: { status: 'modified', staged: false, unstaged: true } }] }));
  for (const key of refKeys('ws')) expect(invalidated(key)).toBe(false);

  // A commit moves HEAD.
  handleGitStatus('ws', '/repo', status(3, { head: { oid: 'b2', branch: 'main' } }));
  for (const key of refKeys('ws')) expect(invalidated(key)).toBe(true);
  for (const key of refKeys('other')) expect(invalidated(key)).toBe(false);
});

test('a branch switch at the same commit also refreshes branch views', () => {
  seed(refKeys('ws'));
  handleGitStatus('ws', '/repo', status(1));
  handleGitStatus('ws', '/repo', status(2, { head: { oid: 'a1', branch: 'feature' } }));
  for (const key of refKeys('ws')) expect(invalidated(key)).toBe(true);
});
