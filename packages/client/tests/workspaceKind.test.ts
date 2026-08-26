import { describe, expect, test } from 'vitest';
import type { Workspace } from '@prokopai/sdk';
import { getWorkspaceDisplayName, isAgentHomeWorkspace } from '@/lib/workspaceKind';

function workspace(settings: Workspace['settings'] = {}): Workspace {
  return {
    id: 'workspace',
    name: 'Workspace',
    path: '/workspace',
    isVirtual: true,
    additionalPaths: [],
    settings,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('isAgentHomeWorkspace', () => {
  test('identifies agent homes from workspace settings', () => {
    expect(isAgentHomeWorkspace(workspace({ isAgentHome: true, agentId: 'coder' }))).toBe(true);
  });

  test('does not classify ordinary virtual workspaces as agent homes', () => {
    expect(isAgentHomeWorkspace(workspace())).toBe(false);
  });

  test('uses the owning agent name for an agent home', () => {
    const home = workspace({ isAgentHome: true, agentId: 'coder' });
    expect(getWorkspaceDisplayName(home, [{ id: 'coder', name: 'Code Agent' }])).toBe(
      'Code Agent',
    );
  });
});
