import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';
import { useWorkspaceSessions } from './useWorkspaceSessions';

export function useSessionCategories(sdkClient: ProkopaiClient | null, workspaceId: string | null, connected: boolean) {
  const [expanded, setExpanded] = useState({ workspaceId, archived: false, scheduled: false });
  // Reset during render so a workspace change cannot fetch a previously expanded category.
  if (expanded.workspaceId !== workspaceId) {
    setExpanded({ workspaceId, archived: false, scheduled: false });
  }
  const archivedOpen = expanded.workspaceId === workspaceId && expanded.archived;
  const scheduledOpen = expanded.workspaceId === workspaceId && expanded.scheduled;
  const counts = useQuery({
    queryKey: queryKeys.sessions.counts(workspaceId ?? ''),
    queryFn: ({ signal }) => sdkClient!.http.sessions.countsByWorkspace(workspaceId!, { signal }),
    enabled: !!sdkClient && !!workspaceId && connected,
    staleTime: 10_000,
  });
  const archived = useWorkspaceSessions({ sdkClient, workspaceId, connected, category: 'archived', enabled: archivedOpen });
  const scheduled = useWorkspaceSessions({ sdkClient, workspaceId, connected, category: 'scheduled', enabled: scheduledOpen });
  return {
    counts: counts.data?.counts,
    countsError: counts.error?.message,
    retryCounts: () => { void counts.refetch(); },
    archived: { ...archived, open: archivedOpen, onOpenChange: (open: boolean) => setExpanded(s => ({ ...s, archived: open })) },
    scheduled: { ...scheduled, open: scheduledOpen, onOpenChange: (open: boolean) => setExpanded(s => ({ ...s, scheduled: open })) },
  };
}

export type SessionCategories = ReturnType<typeof useSessionCategories>;
