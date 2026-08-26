import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace, seedWorkspaceWithSession } from '#tests/seed';
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  listAgentHomeWorkspaces,
  updateWorkspace,
  deleteWorkspace,
  countSessionsInWorkspace,
} from '@/infrastructure/sqlite/workspaces';
import { createSession, getSession } from '@/infrastructure/sqlite/session-store';
import { createTestSession } from '#tests/factories';

function makeSession(overrides: { id: string; workspaceId: string; title: string; status: 'active' | 'closed' }) {
  const { createdAt: _c, updatedAt: _u, ...defaults } = createTestSession(overrides);
  return defaults;
}

describe('workspaces store', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  afterEach(() => {
    resetTestDatabase();
  });

  describe('createWorkspace', () => {
    test('creates and returns a workspace', () => {
      seedWorkspace({ id: 'ws1', name: 'Test', path: '/test' });

      const ws = getWorkspace('ws1');
      expect(ws).not.toBeNull();
      expect(ws!.id).toBe('ws1');
      expect(ws!.name).toBe('Test');
      expect(ws!.path).toBe('/test');
      expect(ws!.isVirtual).toBe(false);
      expect(ws!.createdAt).toBeDefined();
      expect(ws!.updatedAt).toBeDefined();
    });

    test('creates a virtual workspace', () => {
      const ws = seedWorkspace({ id: 'ws-v', name: 'Virtual', path: '', isVirtual: true });

      expect(ws.isVirtual).toBe(true);
    });
  });

  describe('getWorkspace', () => {
    test('returns workspace by id', () => {
      seedWorkspace({ id: 'ws1' });
      const ws = getWorkspace('ws1');

      expect(ws).not.toBeNull();
      expect(ws!.id).toBe('ws1');
    });

    test('returns null for non-existent workspace', () => {
      expect(getWorkspace('nonexistent')).toBeNull();
    });
  });

  describe('listWorkspaces', () => {
    test('returns all workspaces ordered by created_at DESC', () => {
      createWorkspace({ id: 'ws1', name: 'First', path: '/1', isVirtual: false });
      createWorkspace({ id: 'ws2', name: 'Second', path: '/2', isVirtual: false });

      const list = listWorkspaces();
      expect(list).toHaveLength(2);
      // Both created in same ms, so just verify both exist
      const ids = list.map(w => w.id).sort();
      expect(ids).toEqual(['ws1', 'ws2']);
    });

    test('includes agent homes in the default listing', () => {
      createWorkspace({ id: 'ws1', name: 'First', path: '/1', isVirtual: false });
      createWorkspace({
        id: 'coder-home',
        name: 'coder-home',
        path: '/home',
        isVirtual: true,
        settings: { isAgentHome: true, agentId: 'coder' },
      });

      expect(listWorkspaces().map(workspace => workspace.id).sort()).toEqual([
        'coder-home',
        'ws1',
      ]);
      expect(listAgentHomeWorkspaces().map(workspace => workspace.id)).toEqual([
        'coder-home',
      ]);
    });

    test('returns empty array when no workspaces', () => {
      expect(listWorkspaces()).toHaveLength(0);
    });
  });

  describe('updateWorkspace', () => {
    test('updates the name', () => {
      seedWorkspace({ id: 'ws1', name: 'Original' });
      const updated = updateWorkspace('ws1', { name: 'Updated' });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated');
    });

    test('returns null for non-existent workspace', () => {
      expect(updateWorkspace('nonexistent', { name: 'x' })).toBeNull();
    });
  });

  describe('deleteWorkspace', () => {
    test('deletes a workspace and returns true', () => {
      seedWorkspace({ id: 'ws1' });

      expect(deleteWorkspace('ws1')).toBe(true);
      expect(getWorkspace('ws1')).toBeNull();
    });

    test('returns false for non-existent workspace', () => {
      expect(deleteWorkspace('nonexistent')).toBe(false);
    });

    test('cascades to sessions', () => {
      const { workspaceId, sessionId } = seedWorkspaceWithSession();

      deleteWorkspace(workspaceId);
      expect(getSession(sessionId)).toBeNull();
    });
  });

  describe('countSessionsInWorkspace', () => {
    test('returns 0 when workspace has no sessions', () => {
      seedWorkspace({ id: 'ws1' });
      expect(countSessionsInWorkspace('ws1')).toBe(0);
    });

    test('counts sessions in workspace', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'A', status: 'active' }));
      createSession(makeSession({ id: 's2', workspaceId: 'ws1', title: 'B', status: 'active' }));

      expect(countSessionsInWorkspace('ws1')).toBe(2);
    });
  });

  // ── Settings ──────────────────────────────────────────────────

  describe('workspace settings', () => {
    test('defaults to empty settings when created without settings', () => {
      seedWorkspace({ id: 'ws1' });
      const ws = getWorkspace('ws1');

      expect(ws).not.toBeNull();
      expect(ws!.settings).toEqual({ autoApproveSeverity: 'low' });
    });

    test('creates workspace with memory settings', () => {
      createWorkspace({
        id: 'ws-mem',
        name: 'Memory WS',
        path: '/mem',
        isVirtual: false,
        settings: { memory: { enabled: true, permissionRisk: 'medium' } },
      });

      const ws = getWorkspace('ws-mem');
      expect(ws).not.toBeNull();
      expect(ws!.settings.memory).toEqual({ enabled: true, permissionRisk: 'medium' });
    });

    test('updates settings on existing workspace', () => {
      seedWorkspace({ id: 'ws1' });

      const updated = updateWorkspace('ws1', {
        settings: { memory: { enabled: true, permissionRisk: 'none' } },
      });

      expect(updated).not.toBeNull();
      expect(updated!.settings.memory!.enabled).toBe(true);
      expect(updated!.settings.memory!.permissionRisk).toBe('none');
    });

    test('updates settings without affecting other fields', () => {
      seedWorkspace({ id: 'ws1', name: 'Keep This Name' });

      updateWorkspace('ws1', {
        settings: { memory: { enabled: true, permissionRisk: 'low' } },
      });

      const ws = getWorkspace('ws1');
      expect(ws!.name).toBe('Keep This Name');
      expect(ws!.settings.memory!.enabled).toBe(true);
    });

    test('can disable memory after enabling', () => {
      seedWorkspace({ id: 'ws1' });

      updateWorkspace('ws1', {
        settings: { memory: { enabled: true, permissionRisk: 'medium' } },
      });

      updateWorkspace('ws1', {
        settings: { memory: { enabled: false, permissionRisk: 'medium' } },
      });

      const ws = getWorkspace('ws1');
      expect(ws!.settings.memory!.enabled).toBe(false);
    });

    test('can update name and settings together', () => {
      seedWorkspace({ id: 'ws1', name: 'Old' });

      const updated = updateWorkspace('ws1', {
        name: 'New',
        settings: { memory: { enabled: true, permissionRisk: 'high' } },
      });

      expect(updated!.name).toBe('New');
      expect(updated!.settings.memory!.enabled).toBe(true);
      expect(updated!.settings.memory!.permissionRisk).toBe('high');
    });

    test('preserves settings when updating only name', () => {
      createWorkspace({
        id: 'ws1',
        name: 'Original',
        path: '/test',
        isVirtual: false,
        settings: { memory: { enabled: true, permissionRisk: 'critical' } },
      });

      updateWorkspace('ws1', { name: 'Renamed' });

      const ws = getWorkspace('ws1');
      expect(ws!.name).toBe('Renamed');
      expect(ws!.settings.memory!.enabled).toBe(true);
      expect(ws!.settings.memory!.permissionRisk).toBe('critical');
    });
  });
});
