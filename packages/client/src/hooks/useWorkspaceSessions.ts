import { useInfiniteQuery, type QueryClient } from '@tanstack/react-query';
import type { ProkopaiClient, SessionCategory } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';

const WORKSPACE_PAGE_SIZE = 100;
const WORKSPACE_SESSIONS_STALE_MS = 10_000;

function workspaceSessionsQuery(sdkClient: ProkopaiClient | null, workspaceId: string | null, category: SessionCategory) {
  return {
    queryKey: queryKeys.sessions.byWorkspaceInfinite({
      workspaceId: workspaceId ?? '',
      limit: WORKSPACE_PAGE_SIZE,
      rootOnly: true,
      category,
    }),
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      sdkClient!.http.sessions.listByWorkspace({
        workspaceId: workspaceId!,
        limit: WORKSPACE_PAGE_SIZE,
        cursor: pageParam,
        rootOnly: true,
        category,
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: Awaited<ReturnType<ProkopaiClient['http']['sessions']['listByWorkspace']>>) =>
      lastPage.pagination?.hasMore
        ? lastPage.pagination.nextCursor ?? undefined
        : undefined,
    staleTime: WORKSPACE_SESSIONS_STALE_MS,
  };
}

/**
 * Loads a workspace's first session page and counts before it is opened
 * (switcher highlight), so switching renders the full list at once instead of
 * an empty sidebar that fills in.
 */
export function prefetchWorkspaceSessions(queryClient: QueryClient, sdkClient: ProkopaiClient, workspaceId: string): void {
  void queryClient.prefetchInfiniteQuery(workspaceSessionsQuery(sdkClient, workspaceId, 'active'));
  void queryClient.prefetchQuery({
    queryKey: queryKeys.sessions.counts(workspaceId),
    queryFn: ({ signal }) => sdkClient.http.sessions.countsByWorkspace(workspaceId, { signal }),
    staleTime: WORKSPACE_SESSIONS_STALE_MS,
  });
}

interface UseWorkspaceSessionsParams {
  sdkClient: ProkopaiClient | null;
  workspaceId: string | null;
  connected: boolean;
  category?: SessionCategory;
  enabled?: boolean;
}

interface UseWorkspaceSessionsReturn {
  isLoading: boolean;
  error: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  loadedCount: number;
  retry: () => void;
}

export function useWorkspaceSessions({
  sdkClient,
  workspaceId,
  connected,
  category = 'active',
  enabled = true,
}: UseWorkspaceSessionsParams): UseWorkspaceSessionsReturn {
  const query = useInfiniteQuery({
    ...workspaceSessionsQuery(sdkClient, workspaceId, category),
    enabled: enabled && !!sdkClient && connected && !!workspaceId,
  });

  const hasNextPage = query.hasNextPage;
  const isFetchingNextPage = query.isFetchingNextPage;

  const fetchNextPage = () => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  };

  const loadedCount = query.data?.pages.reduce(
    (sum, page) => sum + (page.sessions?.length ?? 0),
    0,
  ) ?? 0;

  return {
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    loadedCount,
    retry: () => { void query.refetch(); },
  };
}
