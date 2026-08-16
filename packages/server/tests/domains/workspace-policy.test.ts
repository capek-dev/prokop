import { describe, expect, test } from 'bun:test';
import {
  autoApproveSeverityOf,
  DEFAULT_WORKSPACE_SETTINGS,
  isAgentHomeWorkspace,
  mapWorkspaceRecord,
  parseWorkspaceSettings,
  workspaceNameOrDefault,
} from '@/domains/workspaces';

// C6 step 4 moved the file-access containment policy into the Capek
// workspace domain; the server consumes it through the path policy adapter
// pinned by `tests/adapters/capek/workspace-paths.test.ts`.

describe('workspace domain: record policy', () => {
  test('pins the default settings and the malformed-JSON fallback', () => {
    expect(DEFAULT_WORKSPACE_SETTINGS).toEqual({ autoApproveSeverity: 'low' });
    expect(parseWorkspaceSettings(null)).toEqual({ autoApproveSeverity: 'low' });
    expect(parseWorkspaceSettings('{"memory":{"enabled":true}}')).toMatchObject({
      autoApproveSeverity: 'low',
      memory: { enabled: true },
    });
    expect(parseWorkspaceSettings('not json')).toEqual({ autoApproveSeverity: 'low' });
  });

  test('maps raw rows with the exact record shape', () => {
    expect(mapWorkspaceRecord({
      id: 'ws1',
      name: 'Main',
      path: '/main',
      is_virtual: 1,
      settings: '{"scheduling":{"enabled":true}}',
      created_at: 'c',
      updated_at: 'u',
    }, ['/extra'])).toMatchObject({
      id: 'ws1',
      name: 'Main',
      path: '/main',
      isVirtual: true,
      additionalPaths: ['/extra'],
      settings: { autoApproveSeverity: 'low', scheduling: { enabled: true } },
      createdAt: 'c',
      updatedAt: 'u',
    });
    expect(mapWorkspaceRecord({
      id: 'ws2',
      name: 'P',
      path: '/p',
      is_virtual: 0,
      settings: null,
      created_at: 'c',
      updated_at: 'u',
    }).additionalPaths).toEqual([]);
  });

  test('classifies agent homes, resolves auto-approve fallbacks, and defaults names', () => {
    expect(isAgentHomeWorkspace({ autoApproveSeverity: 'low' })).toBe(false);
    expect(isAgentHomeWorkspace({ isAgentHome: true })).toBe(true);
    expect(autoApproveSeverityOf(null)).toBe('low');
    expect(autoApproveSeverityOf(undefined)).toBe('low');
    expect(autoApproveSeverityOf({ settings: { autoApproveSeverity: 'medium' } })).toBe('medium');
    expect(workspaceNameOrDefault(undefined)).toBe('New Workspace');
    expect(workspaceNameOrDefault('Named')).toBe('Named');
  });
});
