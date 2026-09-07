import { afterEach, expect, test } from 'vitest';
import { queryClient } from '@/components/providers/QueryProvider';
import { handleGitChanged } from '@/handlers/serverMessage/gitHandlers';

afterEach(() => queryClient.clear());

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
