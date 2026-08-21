import { useEffect } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useSessionStore } from '@/stores/sessionStore';
import { queryKeys } from '@/lib/queryKeys';
import { dedupeAndSortSessions } from '@/lib/sessionUtils';

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
  const replaceSessionsForWorkspace = useSessionStore(s => s.replaceSessionsForWorkspace);
  const removeSessionsForWorkspace = useSessionStore(s => s.removeSessionsForWorkspace);

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

  // When workspace is null, clear sessions for it
  useEffect(() => {
    if (!workspaceId) {
      return;
    }
  }, [workspaceId]);

  // When workspaceId changes, remove old workspace sessions
  useEffect(() => {
    return () => {
      if (workspaceId) {
        removeSessionsForWorkspace(workspaceId);
      }
    };
  }, [workspaceId, removeSessionsForWorkspace]);

  // Merge loaded pages into store
  useEffect(() => {
    if (!workspaceId) return;
    if (!query.data?.pages) return;

    const allSessions = query.data.pages.flatMap((page) => page.sessions);
    const deduped = dedupeAndSortSessions(allSessions);
    replaceSessionsForWorkspace(workspaceId, deduped);
  }, [query.data, workspaceId, replaceSessionsForWorkspace]);

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
