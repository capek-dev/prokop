import { create } from 'zustand';
import type { QuickConnection } from '@prokopai/sdk';
import type { OverviewGroupsDocument } from '@/config/overviewGroupsTypes';
import {
  loadOverviewGroups,
  persistDocument,
} from '@/config/overviewGroupsStorage';

type HydrationStatus = 'idle' | 'loading' | 'ready' | 'unsupported';

interface OverviewGroupsState {
  document: OverviewGroupsDocument;
  hydrationStatus: HydrationStatus;
}

interface OverviewGroupsActions {
  hydrate: (quickConnections: QuickConnection[]) => Promise<void>;
  createGroup: (serverId: string, name: string, workspaceIds?: string[]) => string | null;
  renameGroup: (groupId: string, name: string) => boolean;
  deleteGroup: (groupId: string) => void;
  selectGroup: (serverId: string, groupId: string) => void;
  toggleWorkspace: (groupId: string, workspaceId: string) => void;
  setGroupWorkspaces: (groupId: string, workspaceIds: string[]) => void;
  reorderWorkspace: (groupId: string, workspaceId: string, targetIndex: number) => void;
  removeWorkspaceFromAllGroups: (serverId: string, workspaceId: string) => void;
  removeServerGroups: (serverId: string) => void;
}

const EMPTY_DOC: OverviewGroupsDocument = {
  version: 1,
  groups: [],
  activeGroupIdByServer: {},
};

export const useOverviewGroupsStore = create<
  OverviewGroupsState & OverviewGroupsActions
>((set, get) => {
  let hydrating: Promise<void> | null = null;

  function commit(next: OverviewGroupsDocument) {
    set({ document: next });
    void persistDocument(next);
  }

  function findGroup(doc: OverviewGroupsDocument, groupId: string) {
    return doc.groups.find((g) => g.id === groupId) ?? null;
  }

  function isNameTaken(
    doc: OverviewGroupsDocument,
    serverId: string,
    name: string,
    excludeGroupId?: string,
  ): boolean {
    const lower = name.toLowerCase();
    return doc.groups.some(
      (g) =>
        g.serverId === serverId &&
        g.name.toLowerCase() === lower &&
        g.id !== excludeGroupId,
    );
  }

  return {
    document: { ...EMPTY_DOC, groups: [], activeGroupIdByServer: {} },
    hydrationStatus: 'idle',

    hydrate: (quickConnections) => {
      if (hydrating) return hydrating;
      const status = get().hydrationStatus;
      if (status === 'ready' || status === 'unsupported') return Promise.resolve();

      set({ hydrationStatus: 'loading' });
      hydrating = loadOverviewGroups(quickConnections).then((result) => {
        if (result.status === 'unsupported') {
          set({ hydrationStatus: 'unsupported' });
        } else {
          set({ document: result.document, hydrationStatus: 'ready' });
        }
        hydrating = null;
      }).catch((err: unknown) => {
        console.error('[overviewGroups] Hydration failed:', err);
        set({ hydrationStatus: 'ready' });
        hydrating = null;
      });
      return hydrating;
    },

    createGroup: (serverId, name, workspaceIds) => {
      if (get().hydrationStatus !== 'ready') return null;
      const trimmed = name.trim().slice(0, 50);
      if (!trimmed) return null;
      const doc = get().document;
      if (isNameTaken(doc, serverId, trimmed)) return null;

      const groupId = crypto.randomUUID();
      const newGroup = {
        id: groupId,
        serverId,
        name: trimmed,
        workspaceIds: [...(workspaceIds ?? [])],
      };
      const next: OverviewGroupsDocument = {
        version: 1,
        groups: [...doc.groups, newGroup],
        activeGroupIdByServer: { ...doc.activeGroupIdByServer, [serverId]: groupId },
      };
      commit(next);
      return groupId;
    },

    renameGroup: (groupId, name) => {
      if (get().hydrationStatus !== 'ready') return false;
      const trimmed = name.trim().slice(0, 50);
      if (!trimmed) return false;
      const doc = get().document;
      const group = findGroup(doc, groupId);
      if (!group) return false;
      if (isNameTaken(doc, group.serverId, trimmed, groupId)) return false;

      const next: OverviewGroupsDocument = {
        version: 1,
        groups: doc.groups.map((g) =>
          g.id === groupId ? { ...g, name: trimmed } : g,
        ),
        activeGroupIdByServer: doc.activeGroupIdByServer,
      };
      commit(next);
      return true;
    },

    deleteGroup: (groupId) => {
      if (get().hydrationStatus !== 'ready') return;
      const doc = get().document;
      const group = findGroup(doc, groupId);
      if (!group) return;

      const remaining = doc.groups.filter((g) => g.id !== groupId);
      const activeMap = { ...doc.activeGroupIdByServer };
      // Repair active group for that server
      const serverGroups = remaining.filter((g) => g.serverId === group.serverId);
      if (serverGroups.length > 0) {
        activeMap[group.serverId] = serverGroups[0].id;
      } else {
        delete activeMap[group.serverId];
      }

      commit({ version: 1, groups: remaining, activeGroupIdByServer: activeMap });
    },

    selectGroup: (serverId, groupId) => {
      if (get().hydrationStatus !== 'ready') return;
      const doc = get().document;
      if (!doc.groups.some((g) => g.id === groupId && g.serverId === serverId)) return;
      commit({
        version: 1,
        groups: doc.groups,
        activeGroupIdByServer: { ...doc.activeGroupIdByServer, [serverId]: groupId },
      });
    },

    toggleWorkspace: (groupId, workspaceId) => {
      if (get().hydrationStatus !== 'ready') return;
      const doc = get().document;
      const group = findGroup(doc, groupId);
      if (!group) return;

      let newIds: string[];
      if (group.workspaceIds.includes(workspaceId)) {
        newIds = group.workspaceIds.filter((id) => id !== workspaceId);
      } else {
        newIds = [...group.workspaceIds, workspaceId];
      }
      const next: OverviewGroupsDocument = {
        version: 1,
        groups: doc.groups.map((g) =>
          g.id === groupId ? { ...g, workspaceIds: newIds } : g,
        ),
        activeGroupIdByServer: doc.activeGroupIdByServer,
      };
      commit(next);
    },

    setGroupWorkspaces: (groupId, workspaceIds) => {
      if (get().hydrationStatus !== 'ready') return;
      const doc = get().document;
      const group = findGroup(doc, groupId);
      if (!group) return;

      const ordered = [...new Set(workspaceIds)];

      commit({
        version: 1,
        groups: doc.groups.map((g) =>
          g.id === groupId ? { ...g, workspaceIds: ordered } : g,
        ),
        activeGroupIdByServer: doc.activeGroupIdByServer,
      });
    },

    reorderWorkspace: (groupId, workspaceId, targetIndex) => {
      if (get().hydrationStatus !== 'ready') return;
      const doc = get().document;
      const group = findGroup(doc, groupId);
      if (!group) return;

      const ids = [...group.workspaceIds];
      const fromIndex = ids.indexOf(workspaceId);
      if (fromIndex === -1) return;
      if (targetIndex < 0 || targetIndex >= ids.length) return;
      if (fromIndex === targetIndex) return;

      ids.splice(fromIndex, 1);
      ids.splice(targetIndex, 0, workspaceId);

      commit({
        version: 1,
        groups: doc.groups.map((g) =>
          g.id === groupId ? { ...g, workspaceIds: ids } : g,
        ),
        activeGroupIdByServer: doc.activeGroupIdByServer,
      });
    },

    removeWorkspaceFromAllGroups: (serverId, workspaceId) => {
      if (get().hydrationStatus !== 'ready') return;
      const doc = get().document;
      let changed = false;
      const groups = doc.groups.map((g) => {
        if (g.serverId !== serverId || !g.workspaceIds.includes(workspaceId)) return g;
        changed = true;
        return { ...g, workspaceIds: g.workspaceIds.filter((id) => id !== workspaceId) };
      });
      if (!changed) return;
      commit({ version: 1, groups, activeGroupIdByServer: doc.activeGroupIdByServer });
    },

    removeServerGroups: (serverId) => {
      if (get().hydrationStatus !== 'ready') return;
      const doc = get().document;
      const groups = doc.groups.filter((g) => g.serverId !== serverId);
      const activeMap = { ...doc.activeGroupIdByServer };
      delete activeMap[serverId];
      commit({ version: 1, groups, activeGroupIdByServer: activeMap });
    },
  };
});
