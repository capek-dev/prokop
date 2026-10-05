import { afterEach, expect, test, vi } from 'vitest';
import type { FileTreeResponse, GitStatusResponse, ProkopaiClient } from '@prokopai/sdk';
import { queryClient } from '@/components/providers/QueryProvider';
import { refreshFileTree, refreshGitStatus } from '@/lib/rootFeedRefresh';
import { queryKeys } from '@/lib/queryKeys';

afterEach(() => queryClient.clear());

const status = (revision: number, paths: string[]): GitStatusResponse => ({
  availability: { available: true, root: '/repo' },
  root: '/repo',
  revision,
  files: paths.map((path) => ({ path, git: { status: 'untracked', staged: false, unstaged: true } })) as GitStatusResponse['files'],
});

const tree = (revision: number, paths: string[]): FileTreeResponse => ({ root: '/repo', isMain: true, paths, truncated: false, revision });

function client(gitStatus: GitStatusResponse, fileTree: FileTreeResponse) {
  return {
    http: { files: { gitStatus: vi.fn().mockResolvedValue(gitStatus), tree: vi.fn().mockResolvedValue(fileTree) } },
  };
}

test('manual refresh asks the server to recompute and caches the result', async () => {
  const fake = client(status(20, ['new.ts']), tree(20, ['a.ts', 'new.ts']));
  queryClient.setQueryData(queryKeys.files.gitStatus('ws', undefined), status(10, []));
  queryClient.setQueryData(queryKeys.files.tree('ws', undefined), tree(10, ['a.ts']));

  await refreshGitStatus(fake as unknown as ProkopaiClient, 'ws', undefined);
  await refreshFileTree(fake as unknown as ProkopaiClient, 'ws', undefined);

  expect(fake.http.files.gitStatus).toHaveBeenCalledWith('ws', { root: undefined, refresh: true });
  expect(fake.http.files.tree).toHaveBeenCalledWith('ws', { root: undefined, refresh: true });
  expect(queryClient.getQueryData<GitStatusResponse>(queryKeys.files.gitStatus('ws', undefined))?.revision).toBe(20);
  expect(queryClient.getQueryData<FileTreeResponse>(queryKeys.files.tree('ws', undefined))?.paths).toEqual(['a.ts', 'new.ts']);
});

test('a push that landed first is not overwritten by an older refresh response', async () => {
  const fake = client(status(15, []), tree(15, ['a.ts']));
  queryClient.setQueryData(queryKeys.files.gitStatus('ws', '/repo'), status(30, ['pushed.ts']));

  await refreshGitStatus(fake as unknown as ProkopaiClient, 'ws', '/repo');

  expect(queryClient.getQueryData<GitStatusResponse>(queryKeys.files.gitStatus('ws', '/repo'))?.revision).toBe(30);
});
