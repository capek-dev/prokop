import { useMemo } from 'react';
import type { Workspace } from '@prokopai/sdk';
import { useOverviewGroupsStore } from '@/stores/overviewGroupsStore';
import type { OverviewGroup } from '@/config/overviewGroupsTypes';

export type StoreActions = Omit<
  ReturnType<typeof useOverviewGroupsStore.getState>,
  'document' | 'hydrationStatus'
>;

export interface UseOverviewGroupsReturn {
  groups: OverviewGroup[];
  activeGroup: OverviewGroup | null;
  activeWorkspaceIds: string[];
  activeWorkspaces: Workspace[];
  isHydrated: boolean;
  actions: StoreActions;
}

export function useOverviewGroups(
  serverId: string | undefined,
  workspaces: Workspace[],
): UseOverviewGroupsReturn {
  const document = useOverviewGroupsStore((s) => s.document);
  const hydrationStatus = useOverviewGroupsStore((s) => s.hydrationStatus);
  const actions = useOverviewGroupsStore();

  const sid = serverId ?? '';

  const groups = useMemo(
    () => document.groups.filter((g) => g.serverId === sid),
    [document.groups, sid],
  );

  const activeGroup = useMemo(() => {
    const activeId = document.activeGroupIdByServer[sid];
    if (!activeId) return null;
    return (
      document.groups.find(
        (g) => g.id === activeId && g.serverId === sid,
      ) ?? null
    );
  }, [document.groups, document.activeGroupIdByServer, sid]);

  const activeWorkspaceIds = activeGroup?.workspaceIds ?? [];

  const activeWorkspaces = useMemo(() => {
    const workspaceMap = new Map(workspaces.map((w) => [w.id, w]));
    return activeWorkspaceIds
      .map((id) => workspaceMap.get(id))
      .filter((w): w is Workspace => w !== undefined);
  }, [activeWorkspaceIds, workspaces]);

  return {
    groups,
    activeGroup,
    activeWorkspaceIds,
    activeWorkspaces,
    isHydrated: hydrationStatus === 'ready',
    actions,
  };
}
