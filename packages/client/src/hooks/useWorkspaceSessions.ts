import { useInfiniteQuery } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';

const WORKSPACE_PAGE_SIZE = 100;

interface UseWorkspaceSessionsParams {
  sdkClient: ProkopaiClient | null;
  workspaceId: string | null;
  connected: boolean;
}

interface UseWorkspaceSessionsReturn {
  isLoading: boolean;
  error: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  loadedCount: number;
}

export function useWorkspaceSessions({
  sdkClient,
  workspaceId,
  connected,
}: UseWorkspaceSessionsParams): UseWorkspaceSessionsReturn {
  const query = useInfiniteQuery({
    queryKey: queryKeys.sessions.byWorkspaceInfinite({
      workspaceId: workspaceId ?? '',
      limit: WORKSPACE_PAGE_SIZE,
      rootOnly: true,
    }),
    queryFn: ({ pageParam }) =>
      sdkClient!.http.sessions.listByWorkspace({
        workspaceId: workspaceId!,
        limit: WORKSPACE_PAGE_SIZE,
        cursor: pageParam,
        rootOnly: true,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination?.hasMore
        ? lastPage.pagination.nextCursor ?? undefined
        : undefined,
    enabled: !!sdkClient && connected && !!workspaceId,
    staleTime: 10_000,
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
  };
}
