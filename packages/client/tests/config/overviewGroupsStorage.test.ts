import { describe, test, expect, beforeEach, vi } from 'vitest';
import { mockLocalStorage } from '../helpers';
import {
  loadOverviewGroups,
  persistDocument,
} from '@/config/overviewGroupsStorage';
import { storage, STORAGE_KEYS } from '@/lib/storage';
import type { OverviewGroupsDocument } from '@/config/overviewGroupsTypes';
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

describe('overviewGroupsStorage', () => {
  const ls = mockLocalStorage();

  beforeEach(() => {
    ls.clear();
  });

  describe('missing storage -> migration', () => {
    test('returns empty doc when no quick connections', async () => {
      const result = await loadOverviewGroups([]);
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.document.groups).toHaveLength(0);
      expect(result.migrated).toBe(true);
    });

    test('creates Favorites group per represented server in array order', async () => {
      const qcs = [
        makeQc('srv1', 'wsA', 0),
        makeQc('srv1', 'wsB', 1),
        makeQc('srv2', 'wsC', 2),
      ];
      const result = await loadOverviewGroups(qcs);
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.document.groups).toHaveLength(2);
      const g1 = result.document.groups.find((g) => g.serverId === 'srv1')!;
      expect(g1.name).toBe('Favorites');
      expect(g1.workspaceIds).toEqual(['wsA', 'wsB']);
      const g2 = result.document.groups.find((g) => g.serverId === 'srv2')!;
      expect(g2.workspaceIds).toEqual(['wsC']);
      // active group set per server
      expect(result.document.activeGroupIdByServer['srv1']).toBe(g1.id);
      expect(result.document.activeGroupIdByServer['srv2']).toBe(g2.id);
    });

    test('deduplicates workspace IDs during migration preserving first', async () => {
      const qcs = [
        makeQc('srv1', 'wsA', 0),
        makeQc('srv1', 'wsA', 1),
        makeQc('srv1', 'wsB', 2),
      ];
      const result = await loadOverviewGroups(qcs);
      if (result.status !== 'ready') return;
      const g = result.document.groups[0];
      expect(g.workspaceIds).toEqual(['wsA', 'wsB']);
    });

    test('migration persists the document', async () => {
      await loadOverviewGroups([makeQc('srv1', 'wsA', 0)]);
      const stored = await storage.get<OverviewGroupsDocument>(STORAGE_KEYS.OVERVIEW_GROUPS);
      expect(stored).not.toBeNull();
      expect(stored!.groups).toHaveLength(1);
    });
  });

  describe('existing valid document', () => {
    test('loads a valid version 1 document', async () => {
      const doc: OverviewGroupsDocument = {
        version: 1,
        groups: [
          { id: 'g1', serverId: 'srv1', name: 'Active', workspaceIds: ['wsA', 'wsB'] },
        ],
        activeGroupIdByServer: { srv1: 'g1' },
      };
      await persistDocument(doc);
      const result = await loadOverviewGroups([]);
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.document.groups[0].name).toBe('Active');
      expect(result.migrated).toBe(false);
    });

    test('does not re-migrate when document exists', async () => {
      await persistDocument({
        version: 1,
        groups: [],
        activeGroupIdByServer: {},
      });
      const result = await loadOverviewGroups([makeQc('srv1', 'wsA', 0)]);
      if (result.status !== 'ready') return;
      expect(result.document.groups).toHaveLength(0);
      expect(result.migrated).toBe(false);
    });
  });

  describe('invalid data handling', () => {
    test('does not migrate quick connections when existing JSON is malformed', async () => {
      ls.setItem(STORAGE_KEYS.OVERVIEW_GROUPS, '{malformed');
      const result = await loadOverviewGroups([makeQc('srv1', 'wsA', 0)]);
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.document.groups).toHaveLength(0);
      expect(result.migrated).toBe(false);
    });

    test('does not migrate quick connections when existing value is null', async () => {
      ls.setItem(STORAGE_KEYS.OVERVIEW_GROUPS, 'null');
      const result = await loadOverviewGroups([makeQc('srv1', 'wsA', 0)]);
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.document.groups).toHaveLength(0);
      expect(result.migrated).toBe(false);
    });

    test('rejects invalid root shape and returns empty doc', async () => {
      ls.setItem(STORAGE_KEYS.OVERVIEW_GROUPS, '"just a string"');
      const result = await loadOverviewGroups([]);
      if (result.status !== 'ready') return;
      expect(result.document.groups).toHaveLength(0);
    });

    test('drops malformed group records, keeps valid ones', async () => {
      const raw = {
        version: 1,
        groups: [
          { id: 'g1', serverId: 'srv1', name: 'Valid', workspaceIds: ['wsA'] },
          { id: '', serverId: 'srv1', name: 'NoId', workspaceIds: [] },
          { id: 'g2', serverId: '', name: 'NoServer', workspaceIds: [] },
          { id: 'g3', serverId: 'srv1', name: '  ', workspaceIds: [] },
          { id: 'g4', serverId: 'srv1', name: 'BadWs', workspaceIds: 'not-array' },
        ],
        activeGroupIdByServer: {},
      };
      ls.setItem(STORAGE_KEYS.OVERVIEW_GROUPS, JSON.stringify(raw));
      const result = await loadOverviewGroups([]);
      if (result.status !== 'ready') return;
      expect(result.document.groups).toHaveLength(1);
      expect(result.document.groups[0].id).toBe('g1');
    });

    test('deduplicates duplicate workspace IDs keeping first position', async () => {
      const raw = {
        version: 1,
        groups: [
          { id: 'g1', serverId: 'srv1', name: 'Dup', workspaceIds: ['wsA', 'wsB', 'wsA', 'wsC', 'wsB'] },
        ],
        activeGroupIdByServer: {},
      };
      ls.setItem(STORAGE_KEYS.OVERVIEW_GROUPS, JSON.stringify(raw));
      const result = await loadOverviewGroups([]);
      if (result.status !== 'ready') return;
      expect(result.document.groups[0].workspaceIds).toEqual(['wsA', 'wsB', 'wsC']);
    });

    test('invalid active group reference falls back to first valid group', async () => {
      const raw = {
        version: 1,
        groups: [
          { id: 'g1', serverId: 'srv1', name: 'First', workspaceIds: ['wsA'] },
          { id: 'g2', serverId: 'srv1', name: 'Second', workspaceIds: ['wsB'] },
        ],
        activeGroupIdByServer: { srv1: 'nonexistent' },
      };
      ls.setItem(STORAGE_KEYS.OVERVIEW_GROUPS, JSON.stringify(raw));
      const result = await loadOverviewGroups([]);
      if (result.status !== 'ready') return;
      expect(result.document.activeGroupIdByServer['srv1']).toBe('g1');
    });

    test('removes active-group reference when server has no groups', async () => {
      const raw = {
        version: 1,
        groups: [],
        activeGroupIdByServer: { srv1: 'g1' },
      };
      ls.setItem(STORAGE_KEYS.OVERVIEW_GROUPS, JSON.stringify(raw));
      const result = await loadOverviewGroups([]);
      if (result.status !== 'ready') return;
      expect(result.document.activeGroupIdByServer['srv1']).toBeUndefined();
    });

    test('deduplicates case-insensitive group names per server', async () => {
      const raw = {
        version: 1,
        groups: [
          { id: 'g1', serverId: 'srv1', name: 'Projects', workspaceIds: [] },
          { id: 'g2', serverId: 'srv1', name: 'PROJECTS', workspaceIds: [] },
          { id: 'g3', serverId: 'srv1', name: 'projects', workspaceIds: [] },
        ],
        activeGroupIdByServer: {},
      };
      ls.setItem(STORAGE_KEYS.OVERVIEW_GROUPS, JSON.stringify(raw));
      const result = await loadOverviewGroups([]);
      if (result.status !== 'ready') return;
      const srv1Groups = result.document.groups.filter((g) => g.serverId === 'srv1');
      expect(srv1Groups).toHaveLength(1);
      expect(srv1Groups[0].name).toBe('Projects');
    });

    test('repairs an active reference to a dropped duplicate-name group', async () => {
      const raw = {
        version: 1,
        groups: [
          { id: 'g1', serverId: 'srv1', name: 'Projects', workspaceIds: [] },
          { id: 'g2', serverId: 'srv1', name: 'PROJECTS', workspaceIds: [] },
        ],
        activeGroupIdByServer: { srv1: 'g2' },
      };
      ls.setItem(STORAGE_KEYS.OVERVIEW_GROUPS, JSON.stringify(raw));
      const result = await loadOverviewGroups([]);
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.document.groups.map((group) => group.id)).toEqual(['g1']);
      expect(result.document.activeGroupIdByServer.srv1).toBe('g1');
    });

    test('same name allowed on different servers', async () => {
      const raw = {
        version: 1,
        groups: [
          { id: 'g1', serverId: 'srv1', name: 'Work', workspaceIds: [] },
          { id: 'g2', serverId: 'srv2', name: 'Work', workspaceIds: [] },
        ],
        activeGroupIdByServer: {},
      };
      ls.setItem(STORAGE_KEYS.OVERVIEW_GROUPS, JSON.stringify(raw));
      const result = await loadOverviewGroups([]);
      if (result.status !== 'ready') return;
      expect(result.document.groups).toHaveLength(2);
    });
  });

  describe('unsupported version', () => {
    test('returns unsupported and does not overwrite', async () => {
      const futureDoc = { version: 2, groups: [], activeGroupIdByServer: {} };
      ls.setItem(STORAGE_KEYS.OVERVIEW_GROUPS, JSON.stringify(futureDoc));
      const result = await loadOverviewGroups([]);
      expect(result.status).toBe('unsupported');
      // Verify stored data was not overwritten
      const stored = ls.getItem(STORAGE_KEYS.OVERVIEW_GROUPS);
      expect(stored).toContain('"version":2');
    });
  });

  describe('queued writes', () => {
    test('persists the latest mutation last', async () => {
      const doc1: OverviewGroupsDocument = {
        version: 1,
        groups: [{ id: 'g1', serverId: 'srv1', name: 'First', workspaceIds: ['wsA'] }],
        activeGroupIdByServer: { srv1: 'g1' },
      };
      const doc2: OverviewGroupsDocument = {
        version: 1,
        groups: [{ id: 'g2', serverId: 'srv1', name: 'Second', workspaceIds: ['wsB'] }],
        activeGroupIdByServer: { srv1: 'g2' },
      };
      const doc3: OverviewGroupsDocument = {
        version: 1,
        groups: [{ id: 'g3', serverId: 'srv1', name: 'Third', workspaceIds: ['wsC'] }],
        activeGroupIdByServer: { srv1: 'g3' },
      };

      // Fire writes without awaiting individually
      await Promise.all([
        persistDocument(doc1),
        persistDocument(doc2),
        persistDocument(doc3),
      ]);

      const stored = await storage.get<OverviewGroupsDocument>(STORAGE_KEYS.OVERVIEW_GROUPS);
      expect(stored!.groups[0].id).toBe('g3');
    });
  });

  describe('storage failure logging', () => {
    test('logs write failures without throwing', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const original = storage.set;
      // Temporarily break storage.set
      Object.defineProperty(storage, 'set', {
        value: async () => { throw new Error('disk full'); },
        configurable: true,
      });

      await persistDocument({
        version: 1,
        groups: [],
        activeGroupIdByServer: {},
      });

      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
      Object.defineProperty(storage, 'set', { value: original, configurable: true });
    });
  });
});
