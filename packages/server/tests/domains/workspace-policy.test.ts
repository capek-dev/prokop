import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_WORKSPACE_SETTINGS,
  isAgentHomeWorkspace,
  mapWorkspaceRecord,
  parseWorkspaceSettings,
  permissionModeOf,
  type WorkspaceRecordRow,
} from '@/domains/workspaces';

describe('workspace record policy', () => {
  test('default settings are the standard permission mode', () => {
    expect(DEFAULT_WORKSPACE_SETTINGS).toEqual({ permissionMode: 'standard' });
    expect(parseWorkspaceSettings(null)).toEqual({ permissionMode: 'standard' });
    expect(parseWorkspaceSettings('{}')).toEqual({
      ...DEFAULT_WORKSPACE_SETTINGS,
      permissionMode: 'standard',
    });
    expect(parseWorkspaceSettings('not json')).toEqual({ permissionMode: 'standard' });
  });

  test('parseWorkspaceSettings merges stored settings over defaults', () => {
    expect(parseWorkspaceSettings(JSON.stringify({ permissionMode: 'full' }))).toEqual({
      permissionMode: 'full',
    });
  });

  test('mapWorkspaceRecord maps rows and keeps virtual flag', () => {
    const row: WorkspaceRecordRow = {
      id: 'ws1',
      name: 'Workspace',
      path: '/tmp/ws',
      is_virtual: 1,
      settings: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    const workspace = mapWorkspaceRecord(row);
    expect(workspace.isVirtual).toBe(true);
    expect(workspace.settings).toEqual({ permissionMode: 'standard' });
    expect(mapWorkspaceRecord(row, ['/extra'])).toMatchObject({ additionalPaths: ['/extra'] });
  });

  test('agent-home classification reads the settings flag', () => {
    expect(isAgentHomeWorkspace({ permissionMode: 'standard' })).toBe(false);
    expect(isAgentHomeWorkspace({ permissionMode: 'standard', isAgentHome: true })).toBe(true);
  });

  test('permission mode falls back to standard when workspace or setting is missing', () => {
    expect(permissionModeOf(null)).toBe('standard');
    expect(permissionModeOf(undefined)).toBe('standard');
    expect(permissionModeOf({ settings: {} })).toBe('standard');
    expect(permissionModeOf({ settings: { permissionMode: 'extended' } })).toBe('extended');
    expect(permissionModeOf({ settings: { permissionMode: 'full' } })).toBe('full');
  });
});
