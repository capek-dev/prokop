import { describe, test, expect, beforeEach } from 'vitest';
import { mockLocalStorage } from '../helpers';
import { useOverviewGroupsStore } from '@/stores/overviewGroupsStore';
import type { QuickConnection } from '@prokopai/sdk';

const makeQc = (
  serverId: string,
  workspaceId: string,
  order: number,
): QuickConnection => ({
  id: `qc-${serverId}-${workspaceId}`,
  serverId,
  serverName: `Server ${serverId}`,
  workspaceId,
  workspaceName: `WS ${workspaceId}`,
  order,
});

async function hydrateStore(qcs: QuickConnection[] = []) {
  await useOverviewGroupsStore.getState().hydrate(qcs);
}

describe('overviewGroupsStore', () => {
  mockLocalStorage();

  beforeEach(() => {
    useOverviewGroupsStore.setState({
      document: { version: 1, groups: [], activeGroupIdByServer: {} },
      hydrationStatus: 'idle',
    });
  });

  describe('hydration', () => {
    test('mutate actions are no-ops before hydration', async () => {
      const id = useOverviewGroupsStore.getState().createGroup('srv1', 'Test');
      expect(id).toBeNull();
      useOverviewGroupsStore.getState().selectGroup('srv1', 'x');
      expect(useOverviewGroupsStore.getState().document.groups).toHaveLength(0);
    });

    test('hydrate sets status to ready', async () => {
      await hydrateStore();
      expect(useOverviewGroupsStore.getState().hydrationStatus).toBe('ready');
    });

    test('hydrate is idempotent (dedup concurrent calls)', async () => {
      await Promise.all([
        useOverviewGroupsStore.getState().hydrate([makeQc('srv1', 'wsA', 0)]),
        useOverviewGroupsStore.getState().hydrate([makeQc('srv1', 'wsA', 0)]),
      ]);
      const doc = useOverviewGroupsStore.getState().document;
      expect(doc.groups.filter((g) => g.serverId === 'srv1')).toHaveLength(1);
    });
  });

  describe('createGroup', () => {
    beforeEach(async () => {
      await hydrateStore();
    });

    test('creates a group and selects it', () => {
      const id = useOverviewGroupsStore.getState().createGroup('srv1', 'Active Projects');
      expect(id).not.toBeNull();
      const doc = useOverviewGroupsStore.getState().document;
      const g = doc.groups.find((x) => x.id === id);
      expect(g?.name).toBe('Active Projects');
      expect(doc.activeGroupIdByServer['srv1']).toBe(id);
    });

    test('rejects duplicate names case-insensitively for same server', () => {
      useOverviewGroupsStore.getState().createGroup('srv1', 'Projects');
      const id2 = useOverviewGroupsStore.getState().createGroup('srv1', 'PROJECTS');
      expect(id2).toBeNull();
    });

    test('allows same name on different servers', () => {
      const id1 = useOverviewGroupsStore.getState().createGroup('srv1', 'Work');
      const id2 = useOverviewGroupsStore.getState().createGroup('srv2', 'Work');
      expect(id1).not.toBeNull();
      expect(id2).not.toBeNull();
    });

    test('rejects empty name', () => {
      const id = useOverviewGroupsStore.getState().createGroup('srv1', '   ');
      expect(id).toBeNull();
    });

    test('trims and caps name at 50 chars', () => {
      const long = 'a'.repeat(60);
      const id = useOverviewGroupsStore.getState().createGroup('srv1', long);
      expect(id).not.toBeNull();
      const g = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id);
      expect(g!.name).toHaveLength(50);
    });

    test('accepts initial workspaceIds', () => {
      const id = useOverviewGroupsStore.getState().createGroup('srv1', 'G', ['wsA', 'wsB']);
      const g = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id);
      expect(g!.workspaceIds).toEqual(['wsA', 'wsB']);
    });

    test('empty group is allowed', () => {
      const id = useOverviewGroupsStore.getState().createGroup('srv1', 'Empty');
      expect(id).not.toBeNull();
      const g = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id);
      expect(g!.workspaceIds).toEqual([]);
    });
  });

  describe('renameGroup', () => {
    beforeEach(async () => {
      await hydrateStore();
    });

    test('renames an existing group', () => {
      const id = useOverviewGroupsStore.getState().createGroup('srv1', 'Old');
      expect(useOverviewGroupsStore.getState().renameGroup(id!, 'New')).toBe(true);
      const g = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id);
      expect(g!.name).toBe('New');
    });

    test('rejects duplicate name on rename', () => {
      const id1 = useOverviewGroupsStore.getState().createGroup('srv1', 'A');
      useOverviewGroupsStore.getState().createGroup('srv1', 'B');
      expect(useOverviewGroupsStore.getState().renameGroup(id1!, 'B')).toBe(false);
    });

    test('returns false for unknown group', () => {
      expect(useOverviewGroupsStore.getState().renameGroup('unknown', 'X')).toBe(false);
    });
  });

  describe('deleteGroup', () => {
    beforeEach(async () => {
      await hydrateStore();
    });

    test('deletes a group and repairs active to first remaining', () => {
      const id1 = useOverviewGroupsStore.getState().createGroup('srv1', 'A');
      const id2 = useOverviewGroupsStore.getState().createGroup('srv1', 'B');
      // active is id2
      useOverviewGroupsStore.getState().deleteGroup(id2!);
      expect(useOverviewGroupsStore.getState().document.activeGroupIdByServer['srv1']).toBe(id1);
    });

    test('deleting the last group removes active reference', () => {
      const id1 = useOverviewGroupsStore.getState().createGroup('srv1', 'A');
      useOverviewGroupsStore.getState().deleteGroup(id1!);
      expect(useOverviewGroupsStore.getState().document.activeGroupIdByServer['srv1']).toBeUndefined();
    });

    test('does not affect other servers', () => {
      const id1 = useOverviewGroupsStore.getState().createGroup('srv1', 'A');
      useOverviewGroupsStore.getState().createGroup('srv2', 'B');
      useOverviewGroupsStore.getState().deleteGroup(id1!);
      expect(useOverviewGroupsStore.getState().document.groups.some((g) => g.serverId === 'srv2')).toBe(true);
    });
  });

  describe('toggleWorkspace', () => {
    beforeEach(async () => {
      await hydrateStore();
    });

    test('adds a workspace to a group (append)', () => {
      const id = useOverviewGroupsStore.getState().createGroup('srv1', 'G', ['wsA']);
      useOverviewGroupsStore.getState().toggleWorkspace(id!, 'wsB');
      const g = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id);
      expect(g!.workspaceIds).toEqual(['wsA', 'wsB']);
    });

    test('removes a workspace from a group', () => {
      const id = useOverviewGroupsStore.getState().createGroup('srv1', 'G', ['wsA', 'wsB']);
      useOverviewGroupsStore.getState().toggleWorkspace(id!, 'wsA');
      const g = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id);
      expect(g!.workspaceIds).toEqual(['wsB']);
    });

    test('a workspace can belong to multiple groups', () => {
      const id1 = useOverviewGroupsStore.getState().createGroup('srv1', 'A', ['wsA']);
      const id2 = useOverviewGroupsStore.getState().createGroup('srv1', 'B');
      useOverviewGroupsStore.getState().toggleWorkspace(id2!, 'wsA');
      const g1 = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id1);
      const g2 = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id2);
      expect(g1!.workspaceIds).toContain('wsA');
      expect(g2!.workspaceIds).toContain('wsA');
    });

    test('adding membership appends to that group only', () => {
      const id1 = useOverviewGroupsStore.getState().createGroup('srv1', 'A', ['wsA', 'wsB']);
      const id2 = useOverviewGroupsStore.getState().createGroup('srv1', 'B');
      useOverviewGroupsStore.getState().toggleWorkspace(id2!, 'wsC');
      const g1 = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id1);
      const g2 = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id2);
      expect(g1!.workspaceIds).toEqual(['wsA', 'wsB']);
      expect(g2!.workspaceIds).toEqual(['wsC']);
    });
  });

  describe('setGroupWorkspaces', () => {
    beforeEach(async () => {
      await hydrateStore();
    });

    test('uses the supplied workspace order', () => {
      const id = useOverviewGroupsStore.getState().createGroup('srv1', 'G', ['a', 'b', 'c']);
      useOverviewGroupsStore.getState().setGroupWorkspaces(id!, ['c', 'a', 'b']);
      const group = useOverviewGroupsStore.getState().document.groups.find((item) => item.id === id);
      expect(group!.workspaceIds).toEqual(['c', 'a', 'b']);
    });
  });

  describe('reorderWorkspace', () => {
    beforeEach(async () => {
      await hydrateStore();
    });

    test('moves a workspace forward', () => {
      const id = useOverviewGroupsStore.getState().createGroup('srv1', 'G', ['a', 'b', 'c']);
      useOverviewGroupsStore.getState().reorderWorkspace(id!, 'a', 2);
      const g = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id);
      expect(g!.workspaceIds).toEqual(['b', 'c', 'a']);
    });

    test('moves a workspace backward', () => {
      const id = useOverviewGroupsStore.getState().createGroup('srv1', 'G', ['a', 'b', 'c']);
      useOverviewGroupsStore.getState().reorderWorkspace(id!, 'c', 0);
      const g = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id);
      expect(g!.workspaceIds).toEqual(['c', 'a', 'b']);
    });

    test('reordering affects one group only', () => {
      const id1 = useOverviewGroupsStore.getState().createGroup('srv1', 'A', ['x', 'y']);
      const id2 = useOverviewGroupsStore.getState().createGroup('srv1', 'B', ['x', 'y']);
      useOverviewGroupsStore.getState().reorderWorkspace(id1!, 'y', 0);
      const g1 = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id1);
      const g2 = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id2);
      expect(g1!.workspaceIds).toEqual(['y', 'x']);
      expect(g2!.workspaceIds).toEqual(['x', 'y']);
    });
  });

  describe('unknown workspace IDs', () => {
    beforeEach(async () => {
      await hydrateStore();
    });

    test('remain in state when unresolved', () => {
      const id = useOverviewGroupsStore.getState().createGroup('srv1', 'G', ['wsA', 'unknown-ws']);
      const g = useOverviewGroupsStore.getState().document.groups.find((x) => x.id === id);
      expect(g!.workspaceIds).toContain('unknown-ws');
    });
  });

  describe('cleanup', () => {
    beforeEach(async () => {
      await hydrateStore();
    });

    test('removeWorkspaceFromAllGroups removes matching records only', () => {
      useOverviewGroupsStore.getState().createGroup('srv1', 'A', ['wsA', 'wsB']);
      useOverviewGroupsStore.getState().createGroup('srv1', 'B', ['wsA']);
      useOverviewGroupsStore.getState().createGroup('srv2', 'C', ['wsA']);
      useOverviewGroupsStore.getState().removeWorkspaceFromAllGroups('srv1', 'wsA');
      const doc = useOverviewGroupsStore.getState().document;
      const srv1Groups = doc.groups.filter((g) => g.serverId === 'srv1');
      expect(srv1Groups.every((g) => !g.workspaceIds.includes('wsA'))).toBe(true);
      // srv2 unaffected
      const srv2Group = doc.groups.find((g) => g.serverId === 'srv2');
      expect(srv2Group!.workspaceIds).toContain('wsA');
    });

    test('removeServerGroups removes only that server', () => {
      useOverviewGroupsStore.getState().createGroup('srv1', 'A');
      useOverviewGroupsStore.getState().createGroup('srv2', 'B');
      useOverviewGroupsStore.getState().removeServerGroups('srv1');
      const doc = useOverviewGroupsStore.getState().document;
      expect(doc.groups.some((g) => g.serverId === 'srv1')).toBe(false);
      expect(doc.groups.some((g) => g.serverId === 'srv2')).toBe(true);
      expect(doc.activeGroupIdByServer['srv1']).toBeUndefined();
    });
  });
});
