import type { Workspace } from '@prokopai/sdk';
import { mockId, mockIsoNow, merge } from './mockHelpers';

// =============================================================================
// Workspace Factory
// =============================================================================

export type MockWorkspaceOverrides = Partial<Workspace>;

export function createWorkspace(overrides: MockWorkspaceOverrides = {}): Workspace {
  const id = overrides.id ?? mockId('ws');
  return merge<Workspace>(
    {
      id,
      name: 'my-project',
      path: `/home/user/${id}`,
      isVirtual: false,
      additionalPaths: [],
      settings: {},
      createdAt: mockIsoNow(),
      updatedAt: mockIsoNow(),
    },
    overrides,
  );
}

// =============================================================================
// Pre-built workspace variants
// =============================================================================

export const workspacePresets = {
  default: createWorkspace(),
  virtual: createWorkspace({ name: 'scratch-pad', path: '/virtual/scratch-pad', isVirtual: true }),
  monorepo: createWorkspace({ name: 'jean2', path: '/home/user/jean2' }),
  withLongPath: createWorkspace({
    name: 'deeply-nested-repo',
    path: '/home/user/projects/work/team/deeply-nested-repo',
  }),
} as const;
