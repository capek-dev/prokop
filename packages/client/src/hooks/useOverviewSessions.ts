import { useEffect, useMemo, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProkopaiClient, Session } from '@prokopai/sdk';
import { useSessionStore } from '@/stores/sessionStore';
import { queryKeys } from '@/lib/queryKeys';
import { RENDER_BUDGETS } from '@/lib/renderBudgets';

const OVERVIEW_LIMIT_PER_WORKSPACE = RENDER_BUDGETS.overviewInitialPageSize;

interface UseOverviewSessionsParams {
  sdkClient: ProkopaiClient | null;
  workspaceIds: string[];
  connected: boolean;
}

interface UseOverviewSessionsReturn {
  sessionsByWorkspace: Record<string, Session[]>;
  tagGroupsByWorkspace: Record<string, Map<string, Session[]>>;
  orderedTagNamesByWorkspace: Record<string, string[]>;
  allWorkspaceTagsByWorkspace: Record<string, string[]>;
  hasMoreByWorkspace: Record<string, boolean>;
  isLoading: boolean;
  error: string | null;
  fetchNextPageForWorkspace: (workspaceId: string) => void;
  loadingMoreWorkspace: string | null;
}

export function useOverviewSessions({
  sdkClient,
  workspaceIds,
  connected,
}: UseOverviewSessionsParams): UseOverviewSessionsReturn {
  const mergeSessions = useSessionStore(s => s.mergeSessions);
  const allSessions = useSessionStore(s => s.sessions);

  // Per-workspace cursor state (updated via setState, not refs, to avoid render-time ref reads)
  const [cursorsByWorkspace, setCursorsByWorkspace] = useState<Record<string, string | undefined>>({});
  const [loadingMoreWorkspace, setLoadingMoreWorkspace] = useState<string | null>(null);

  // Phase 6: Bounded grouped query for the first page per workspace
  const groupedQuery = useQuery({
    queryKey: queryKeys.sessions.groupedBounded(
      workspaceIds,
      'active',
      OVERVIEW_LIMIT_PER_WORKSPACE,
    ),
    queryFn: () =>
      sdkClient!.http.sessions.listGrouped({
        workspaceIds,
        status: 'active',
        rootOnly: true,
        limitPerWorkspace: OVERVIEW_LIMIT_PER_WORKSPACE,
      }),
    enabled: !!sdkClient && connected && workspaceIds.length > 0,
    staleTime: 10_000,
  });

  const groupedPagination = groupedQuery.data?.pagination;

  // Initialize cursors from grouped pagination metadata
  useEffect(() => {
    if (!groupedPagination) return;
    setCursorsByWorkspace((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const wsId of workspaceIds) {
        const info = groupedPagination[wsId];
        if (info?.nextCursor && !(wsId in next)) {
          next[wsId] = info.nextCursor;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [groupedPagination, workspaceIds]);

  // Merge the initial grouped page into the store
  useEffect(() => {
    if (groupedQuery.data?.sessions) {
      const flatSessions = Object.values(groupedQuery.data.sessions).flat();
      mergeSessions(flatSessions);
    }
  }, [groupedQuery.data, mergeSessions]);

  const fetchNextPageForWorkspace = useCallback((workspaceId: string) => {
    const cursor = cursorsByWorkspace[workspaceId];
    if (!cursor || !sdkClient || loadingMoreWorkspace) return;
    setLoadingMoreWorkspace(workspaceId);

    sdkClient.http.sessions.listByWorkspace({
      workspaceId,
      status: 'active',
      rootOnly: true,
      limit: OVERVIEW_LIMIT_PER_WORKSPACE,
      cursor,
    }).then((response) => {
      if (response.sessions.length > 0) {
        mergeSessions(response.sessions);
      }
      const nextCursor = response.pagination?.hasMore
        ? response.pagination.nextCursor ?? undefined
        : undefined;
      setCursorsByWorkspace((prev) => ({ ...prev, [workspaceId]: nextCursor }));
      setLoadingMoreWorkspace(null);
    }).catch(() => {
      setLoadingMoreWorkspace(null);
    });
  }, [sdkClient, mergeSessions, cursorsByWorkspace, loadingMoreWorkspace]);

  // Derive sessionsByWorkspace from the store (deduplicated, server-sorted)
  const sessionsByWorkspace = useMemo(() => {
    const grouped: Record<string, Session[]> = {};
    for (const id of workspaceIds) {
      grouped[id] = [];
    }
    const workspaceIdSet = new Set(workspaceIds);
    for (const session of allSessions) {
      if (
        workspaceIdSet.has(session.workspaceId)
        && !session.parentId
        && session.status === 'active'
        && !session.metadata?.scheduledJobId
      ) {
        grouped[session.workspaceId].push(session);
      }
    }
    return grouped;
  }, [allSessions, workspaceIds]);

  const tagGroupsByWorkspace = useMemo(() => {
    const result: Record<string, Map<string, Session[]>> = {};
    for (const id of workspaceIds) {
      const sessions = sessionsByWorkspace[id] ?? [];
      const groups = new Map<string, Session[]>();
      const ungrouped: Session[] = [];
      for (const session of sessions) {
        const primaryTag = session.tags?.[0];
        if (primaryTag) {
          const existing = groups.get(primaryTag) ?? [];
          existing.push(session);
          groups.set(primaryTag, existing);
        } else {
          ungrouped.push(session);
        }
      }
      if (ungrouped.length > 0) {
        groups.set('__ungrouped__', ungrouped);
      }
      result[id] = groups;
    }
    return result;
  }, [sessionsByWorkspace, workspaceIds]);

  const orderedTagNamesByWorkspace = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const id of workspaceIds) {
      const groups = tagGroupsByWorkspace[id] ?? new Map();
      const entries: { tag: string; lastUpdated: number }[] = [];
      for (const [tag, sessions] of groups) {
        if (tag === '__ungrouped__') continue;
        let latest = 0;
        for (const s of sessions) {
          const ts = new Date(s.updatedAt).getTime();
          if (ts > latest) latest = ts;
        }
        entries.push({ tag, lastUpdated: latest });
      }
      entries.sort((a, b) => b.lastUpdated - a.lastUpdated);
      result[id] = entries.map(e => e.tag);
    }
    return result;
  }, [tagGroupsByWorkspace, workspaceIds]);

  const allWorkspaceTagsByWorkspace = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const id of workspaceIds) {
      const groups = tagGroupsByWorkspace[id] ?? new Map();
      result[id] = Array.from(groups.keys()).filter(tag => tag !== '__ungrouped__');
    }
    return result;
  }, [tagGroupsByWorkspace, workspaceIds]);

  const hasMoreByWorkspace = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const id of workspaceIds) {
      result[id] = cursorsByWorkspace[id] !== undefined;
    }
    return result;
  }, [cursorsByWorkspace, workspaceIds]);

  return {
    sessionsByWorkspace,
    tagGroupsByWorkspace,
    orderedTagNamesByWorkspace,
    allWorkspaceTagsByWorkspace,
    hasMoreByWorkspace,
    isLoading: groupedQuery.isLoading,
    error: groupedQuery.error?.message ?? null,
    fetchNextPageForWorkspace,
    loadingMoreWorkspace,
  };
}
