import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { StoreHydrator } from '@/components/providers/StoreHydrator';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';

vi.mock('@tanstack/react-router', () => ({
  useLoaderData: () => undefined,
  useParams: () => ({ serverId: 'server-a' }),
}));
vi.mock('@/contexts/ServerContext', () => ({
  useServerContext: () => ({ servers: [], quickConnections: [], isHydrated: false }),
}));

afterEach(() => {
  cleanup();
  queryClient.clear();
});

test('leaving a server clears experimental settings and provider credential readiness', () => {
  queryClient.setQueryData(queryKeys.config.contextSelection, { enabled: true, configured: true });
  queryClient.setQueryData(['providers', 'credentials'], { providers: [{ provider: 'typesafe', configured: true }] });
  queryClient.setQueryData(['unrelated'], 'preserved');

  const view = render(<StoreHydrator><div>Server content</div></StoreHydrator>);
  view.unmount();

  expect(queryClient.getQueryData(queryKeys.config.contextSelection)).toBeUndefined();
  expect(queryClient.getQueryData(['providers', 'credentials'])).toBeUndefined();
  expect(queryClient.getQueryData(['unrelated'])).toBe('preserved');
});
