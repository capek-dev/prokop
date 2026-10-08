import { afterEach, expect, test } from 'vitest';
import { queryClient } from '@/components/providers/QueryProvider';
import { handlePullRequestChanged } from '@/handlers/serverMessage/pullRequestHandlers';

afterEach(() => queryClient.clear());

test('PR changes invalidate all checkouts of the matching server, workspace and repository', () => {
  const keys = [
    ['pull-requests', 'server', 'ws', 'github:acme/app', 'origin', '/one', 'alice'],
    ['pull-requests', 'server', 'ws', 'github:acme/app', 'upstream', '/two', 'alice'],
    ['pull-requests', 'other-server', 'ws', 'github:acme/app'],
    ['pull-requests', 'server', 'other-ws', 'github:acme/app'],
    ['pull-requests', 'server', 'ws', 'github:acme/other'],
  ];
  for (const key of keys) queryClient.setQueryData(key, {});
  handlePullRequestChanged('server', 'ws', 'github:acme/app');
  expect(keys.map((key) => queryClient.getQueryState(key)?.isInvalidated)).toEqual([
    true,
    true,
    false,
    false,
    false,
  ]);
});

test('reconnection refreshes repository discovery and PR data only for that server', () => {
  const keys = [
    ['pull-requests', 'server', 'ws', 'connections'],
    ['pull-requests', 'server', 'other-ws', 'github:acme/app'],
    ['pull-requests', 'other-server', 'ws', 'connections'],
  ];
  for (const key of keys) queryClient.setQueryData(key, {});
  handlePullRequestChanged('server');
  expect(keys.map((key) => queryClient.getQueryState(key)?.isInvalidated)).toEqual([true, true, false]);
});
