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
  const ALWAYS_ON_SEARCH = { enabled: true, permissionRisk: 'none', includeToolResults: false } as const;

  test('default settings are the standard permission mode with session search always on', () => {
    expect(DEFAULT_WORKSPACE_SETTINGS).toEqual({ permissionMode: 'standard' });
    expect(parseWorkspaceSettings(null)).toEqual({ permissionMode: 'standard', sessionSearch: ALWAYS_ON_SEARCH });
    expect(parseWorkspaceSettings('{}')).toEqual({
      ...DEFAULT_WORKSPACE_SETTINGS,
      permissionMode: 'standard',
      sessionSearch: ALWAYS_ON_SEARCH,
    });
    expect(parseWorkspaceSettings('not json')).toEqual({ permissionMode: 'standard', sessionSearch: ALWAYS_ON_SEARCH });
  });

  test('parseWorkspaceSettings merges stored settings over defaults', () => {
    expect(parseWorkspaceSettings(JSON.stringify({ permissionMode: 'full' }))).toEqual({
      permissionMode: 'full',
      sessionSearch: ALWAYS_ON_SEARCH,
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
    expect(workspace.settings).toEqual({ permissionMode: 'standard', sessionSearch: ALWAYS_ON_SEARCH });
    expect(mapWorkspaceRecord(row, ['/extra'])).toMatchObject({ additionalPaths: ['/extra'] });
  });

  test('stored session-search values are ignored: search is always on and risk-free', () => {
    const stored = parseWorkspaceSettings(JSON.stringify({
      sessionSearch: { enabled: false, permissionRisk: 'high', includeToolResults: true },
    }));
    expect(stored.sessionSearch).toEqual(ALWAYS_ON_SEARCH);
  });

  test('agent homes force the workspace memory and skill-manage surfaces off', () => {
    const home = parseWorkspaceSettings(JSON.stringify({
      isAgentHome: true,
      agentId: 'coder',
      memory: { enabled: true, permissionRisk: 'none' },
      skills: { managementEnabled: true, permissionRisk: 'none' },
    }));
    expect(home.memory?.enabled).toBe(false);
    expect(home.skills?.managementEnabled).toBe(false);

    const normal = parseWorkspaceSettings(JSON.stringify({
      memory: { enabled: true, permissionRisk: 'none' },
      skills: { managementEnabled: true, permissionRisk: 'none' },
    }));
    expect(normal.memory?.enabled).toBe(true);
    expect(normal.skills?.managementEnabled).toBe(true);
  });

  test('stale per-workspace preconfig selections are dropped; only defaultId survives', () => {
    const stored = parseWorkspaceSettings(JSON.stringify({
      preconfigs: { selectedIds: ['one', 'two'], defaultId: 'two' },
    }));
    expect(stored.preconfigs).toEqual({ selectedIds: null, defaultId: 'two' });
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
