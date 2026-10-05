import { afterEach, expect, test } from 'vitest';
import type { FileTreeResponse } from '@prokopai/sdk';
import { queryClient } from '@/components/providers/QueryProvider';
import { handleFileTree } from '@/handlers/serverMessage/fileHandlers';
import { newerFileTree } from '@/lib/fileTreePaths';
import { queryKeys } from '@/lib/queryKeys';

afterEach(() => queryClient.clear());

function tree(revision: number, paths: string[], root = '/repo'): FileTreeResponse {
  return { root, isMain: root === '/repo', paths, truncated: false, revision };
}

const mainKey = queryKeys.files.tree('ws', undefined);
const cached = (key: readonly unknown[] = mainKey) => queryClient.getQueryData<FileTreeResponse>(key);

test('a delta on top of the held revision patches the cached tree in order', () => {
  queryClient.setQueryData(mainKey, tree(10, ['README.md', 'src/', 'src/a.ts', 'src/b.ts']));

  handleFileTree('ws', '/repo', {
    kind: 'delta', baseRevision: 10, revision: 11, added: ['src/0.ts', 'src/c/', 'src/c/d.ts'], removed: ['src/b.ts'], truncated: false,
  });

  expect(cached()).toEqual(tree(11, ['README.md', 'src/', 'src/0.ts', 'src/a.ts', 'src/c/', 'src/c/d.ts']));
});

test('a delta for a missed revision refetches instead of patching', () => {
  queryClient.setQueryData(mainKey, tree(10, ['a.ts']));

  handleFileTree('ws', '/repo', { kind: 'delta', baseRevision: 11, revision: 12, added: ['b.ts'], removed: [], truncated: false });

  expect(cached()).toEqual(tree(10, ['a.ts']));
  expect(queryClient.getQueryState(mainKey)?.isInvalidated).toBe(true);
});

test('older deltas and snapshots are ignored', () => {
  queryClient.setQueryData(mainKey, tree(12, ['a.ts']));

  handleFileTree('ws', '/repo', { kind: 'delta', baseRevision: 10, revision: 11, added: ['b.ts'], removed: [], truncated: false });
  handleFileTree('ws', '/repo', { kind: 'snapshot', tree: tree(11, ['old.ts']) });

  expect(cached()).toEqual(tree(12, ['a.ts']));
  expect(queryClient.getQueryState(mainKey)?.isInvalidated).toBe(false);
});

test('a newer snapshot replaces only trees of the same workspace root', () => {
  const worktreeKey = queryKeys.files.tree('ws', '/worktree');
  const otherWorkspaceKey = queryKeys.files.tree('other', undefined);
  queryClient.setQueryData(mainKey, tree(10, ['a.ts']));
  queryClient.setQueryData(worktreeKey, tree(10, ['w.ts'], '/worktree'));
  queryClient.setQueryData(otherWorkspaceKey, tree(10, ['o.ts']));

  handleFileTree('ws', '/repo', { kind: 'snapshot', tree: tree(20, ['a.ts', 'b.ts']) });

  expect(cached()?.paths).toEqual(['a.ts', 'b.ts']);
  expect(cached(worktreeKey)?.paths).toEqual(['w.ts']);
  expect(cached(otherWorkspaceKey)?.paths).toEqual(['o.ts']);
});

test('HTTP reads never replace a newer pushed tree', () => {
  const pushed = tree(12, ['a.ts', 'b.ts']);
  expect(newerFileTree(pushed, tree(11, ['a.ts']))).toBe(pushed);
  expect(newerFileTree(pushed, tree(13, ['c.ts'])).paths).toEqual(['c.ts']);
  expect(newerFileTree(undefined, pushed)).toBe(pushed);
});
