import { describe, test, expect, beforeEach } from 'vitest';
import { mockLocalStorage } from '../helpers';
import {
  getSavedServers,
  getServerById,
  saveServer,
  updateServer,
  deleteServer,
  getQuickConnections,
  addQuickConnection,
  removeQuickConnection,
  removeQuickConnectionForWorkspace,
  updateQuickConnection,
  reorderQuickConnections,
} from '@/config/servers';
import type { SavedServer } from '@prokopai/sdk';

const makeServer = (id: string, overrides: Partial<SavedServer> = {}): SavedServer => ({
  id,
  name: `Server ${id}`,
  url: `localhost:300${id}`,
  createdAt: new Date().toISOString(),
  ...overrides,
} as SavedServer);

describe('servers', () => {
  const storage = mockLocalStorage();

  beforeEach(() => {
    storage.clear();
  });

  describe('getSavedServers', () => {
    test('returns empty array when nothing stored', () => {
      expect(getSavedServers()).toEqual([]);
    });
  });

  describe('saveServer / getServerById', () => {
    test('saves and retrieves a server', () => {
      const server = makeServer('s1');
      saveServer(server);
      expect(getServerById('s1')).toEqual(server);
    });

    test('saves multiple servers', () => {
      saveServer(makeServer('s1'));
      saveServer(makeServer('s2'));
      expect(getSavedServers()).toHaveLength(2);
    });

    test('getServerById returns null for unknown id', () => {
      expect(getServerById('nonexistent')).toBeNull();
    });
  });

  describe('updateServer', () => {
    test('updates server fields', () => {
      saveServer(makeServer('s1'));
      updateServer('s1', { name: 'Updated Name' });
      expect(getServerById('s1')?.name).toBe('Updated Name');
    });

    test('does nothing for unknown server', () => {
      saveServer(makeServer('s1'));
      updateServer('nonexistent', { name: 'X' });
      expect(getSavedServers()).toHaveLength(1);
    });
  });

  describe('deleteServer', () => {
    test('removes server', () => {
      saveServer(makeServer('s1'));
      saveServer(makeServer('s2'));
      deleteServer('s1');
      expect(getSavedServers()).toHaveLength(1);
      expect(getServerById('s1')).toBeNull();
    });

    test('removes related quick connections', () => {
      saveServer(makeServer('s1'));
      addQuickConnection({ serverId: 's1', workspaceId: 'w1', serverName: 'test' });
      deleteServer('s1');
      expect(getQuickConnections()).toHaveLength(0);
    });
  });

  describe('quick connections', () => {
    test('addQuickConnection creates with auto id and order', () => {
      const conn = addQuickConnection({ serverId: 's1', workspaceId: 'w1', serverName: 'test' });
      expect(conn.id).toBeDefined();
      expect(conn.order).toBe(0);
    });

    test('increments order for subsequent connections', () => {
      addQuickConnection({ serverId: 's1', workspaceId: 'w1', serverName: 'first' });
      const second = addQuickConnection({ serverId: 's1', workspaceId: 'w2', serverName: 'second' });
      expect(second.order).toBe(1);
    });

    test('getQuickConnections returns all', () => {
      addQuickConnection({ serverId: 's1', workspaceId: 'w1', serverName: 'c1' });
      addQuickConnection({ serverId: 's1', workspaceId: 'w2', serverName: 'c2' });
      expect(getQuickConnections()).toHaveLength(2);
    });

    test('removeQuickConnection removes by id', () => {
      const conn = addQuickConnection({ serverId: 's1', workspaceId: 'w1', serverName: 'test' });
      removeQuickConnection(conn.id);
      expect(getQuickConnections()).toHaveLength(0);
    });

    test('removeQuickConnectionForWorkspace filters by workspace', () => {
      addQuickConnection({ serverId: 's1', workspaceId: 'w1', serverName: 'c1' });
      addQuickConnection({ serverId: 's1', workspaceId: 'w2', serverName: 'c2' });
      removeQuickConnectionForWorkspace('w1');
      const remaining = getQuickConnections();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].workspaceId).toBe('w2');
    });

    test('updateQuickConnection updates fields', () => {
      const conn = addQuickConnection({ serverId: 's1', workspaceId: 'w1', serverName: 'old' });
      updateQuickConnection(conn.id, { serverName: 'New' });
      expect(getQuickConnections()[0].serverName).toBe('New');
    });

    test('reorderQuickConnections updates order', () => {
      const c1 = addQuickConnection({ serverId: 's1', workspaceId: 'w1', serverName: 'c1' });
      const c2 = addQuickConnection({ serverId: 's1', workspaceId: 'w2', serverName: 'c2' });
      const c3 = addQuickConnection({ serverId: 's1', workspaceId: 'w3', serverName: 'c3' });

      reorderQuickConnections([c3.id, c1.id, c2.id]);

      const conns = getQuickConnections();
      const sorted = [...conns].sort((a, b) => a.order - b.order);
      expect(sorted[0].id).toBe(c3.id);
      expect(sorted[1].id).toBe(c1.id);
      expect(sorted[2].id).toBe(c2.id);
    });
  });

  describe('corrupted storage', () => {
    test('getSavedServers returns empty for invalid JSON', () => {
      storage.setItem('jean2_servers', 'not-json');
      expect(getSavedServers()).toEqual([]);
    });

    test('getQuickConnections returns empty for invalid JSON', () => {
      storage.setItem('jean2_quick_connections', 'not-json');
      expect(getQuickConnections()).toEqual([]);
    });
  });
});
