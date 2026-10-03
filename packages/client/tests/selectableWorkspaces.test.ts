import { describe, expect, test } from 'vitest';
import type { Workspace } from '@prokopai/sdk';
import { getSelectableWorkspaces } from '@/lib/workspaceKind';

function workspace(id: string, settings: Workspace['settings'] = {}): Workspace {
  return { id, name: id, path: `/${id}`, isVirtual: true, additionalPaths: [], settings, createdAt: '', updatedAt: '' };
}

describe('getSelectableWorkspaces', () => {
  test('hides deleted-agent homes without removing stored workspace data', () => {
    const ordinary = workspace('project');
    const home = workspace('coder-home', { isAgentHome: true, agentId: 'coder' });
    const stored = [ordinary, home];
    expect(getSelectableWorkspaces(stored, [{ id: 'coder' }])).toEqual(stored);
    expect(getSelectableWorkspaces(stored, [])).toEqual([ordinary]);
    expect(stored).toEqual([ordinary, home]);
    expect(home.settings).toEqual({ isAgentHome: true, agentId: 'coder' });
  });

  test('keeps live homes and ordinary workspaces but excludes missing owners', () => {
    const ordinary = workspace('project', { agentId: 'deleted' });
    const live = workspace('live-home', { isAgentHome: true, agentId: 'live' });
    const deleted = workspace('deleted-home', { isAgentHome: true, agentId: 'deleted' });
    const missing = workspace('missing-home', { isAgentHome: true });
    expect(getSelectableWorkspaces([ordinary, live, deleted, missing], [{ id: 'live' }]))
      .toEqual([ordinary, live]);
  });
});
