import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useSessionCategories } from '@/hooks/useSessionCategories';
import { useWorkspaceSessions } from '@/hooks/useWorkspaceSessions';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const listByWorkspace = vi.fn().mockResolvedValue({ sessions: [], pagination: { hasMore: false, nextCursor: null, limit: 100 } });
  const countsByWorkspace = vi.fn().mockResolvedValue({ counts: { active: 1, archived: 30, scheduled: 20 } });
  const sdk = { http: { sessions: { listByWorkspace, countsByWorkspace } } } as unknown as ProkopaiClient;
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, listByWorkspace, countsByWorkspace, sdk, wrapper };
}

describe('lazy session categories', () => {
  test('loads only normal sessions and counts until expansion, resets across workspace visits', async () => {
    const { sdk, wrapper, client, listByWorkspace, countsByWorkspace } = setup();
    const { result, rerender, unmount } = renderHook(({ workspaceId }) => {
      useWorkspaceSessions({ sdkClient: sdk, workspaceId, connected: true });
      return useSessionCategories(sdk, workspaceId, true);
    }, { wrapper, initialProps: { workspaceId: 'one' } });
    await waitFor(() => expect(result.current.counts?.archived).toBe(30));
    expect(countsByWorkspace).toHaveBeenCalledTimes(1);
    expect(listByWorkspace.mock.calls.map(([options]) => options.category)).toEqual(['active']);
    expect(result.current.archived.open).toBe(false);
    expect(result.current.scheduled.open).toBe(false);
    act(() => result.current.archived.onOpenChange(true));
    await waitFor(() => expect(listByWorkspace).toHaveBeenCalledTimes(2));
    expect(listByWorkspace.mock.calls[1][0]).toMatchObject({ workspaceId: 'one', category: 'archived' });
    act(() => result.current.scheduled.onOpenChange(true));
    await waitFor(() => expect(listByWorkspace).toHaveBeenCalledTimes(3));
    expect(listByWorkspace.mock.calls[2][0]).toMatchObject({ category: 'scheduled' });
    rerender({ workspaceId: 'two' });
    await waitFor(() => expect(countsByWorkspace).toHaveBeenCalledTimes(2));
    expect(result.current.archived.open).toBe(false);
    expect(result.current.scheduled.open).toBe(false);
    expect(listByWorkspace.mock.calls.filter(([o]) => o.workspaceId === 'two').map(([o]) => o.category)).toEqual(['active']);
    rerender({ workspaceId: 'one' });
    expect(result.current.archived.open).toBe(false);
    expect(result.current.scheduled.open).toBe(false);
    unmount();
    client.clear();
  });

  test('invalidation refreshes counts but not collapsed lists, and pagination stays category-scoped', async () => {
    const { sdk, wrapper, client, listByWorkspace, countsByWorkspace } = setup();
    const { result, unmount } = renderHook(() => useSessionCategories(sdk, 'one', true), { wrapper });
    await waitFor(() => expect(result.current.counts).toBeDefined());
    await act(() => client.invalidateQueries({ queryKey: ['sessions'] }));
    expect(countsByWorkspace).toHaveBeenCalledTimes(2);
    expect(listByWorkspace).not.toHaveBeenCalled();
    listByWorkspace.mockResolvedValueOnce({ sessions: [], pagination: { hasMore: true, nextCursor: 'older', limit: 100 } });
    act(() => result.current.archived.onOpenChange(true));
    await waitFor(() => expect(result.current.archived.hasNextPage).toBe(true));
    act(() => result.current.archived.fetchNextPage());
    await waitFor(() => expect(listByWorkspace).toHaveBeenCalledTimes(2));
    expect(listByWorkspace.mock.calls[1][0]).toMatchObject({ category: 'archived', cursor: 'older' });
    act(() => result.current.archived.onOpenChange(false));
    await act(() => client.invalidateQueries({ queryKey: ['sessions'] }));
    expect(listByWorkspace).toHaveBeenCalledTimes(2);
    unmount();
    client.clear();
  });
});
