import type { GitWorktreeRef, ManagedWorktree } from '@prokopai/sdk';
import { mockId, mockIsoNow, merge } from './mockHelpers';

// =============================================================================
// Managed Worktree Factory
// =============================================================================

export type MockWorktreeOverrides = Partial<ManagedWorktree>;

export function createWorktree(overrides: MockWorktreeOverrides = {}): ManagedWorktree {
  const id = overrides.id ?? mockId('wt');
  return merge<ManagedWorktree>(
    {
      id,
      name: `worktree-${id}`,
      workspaceId: mockId('ws'),
      repositoryId: mockId('repo'),
      path: `/home/user/.prokopai/worktrees/${id}`,
      branch: 'feature/drywall',
      head: 'abc1234',
      state: 'available',
      dirty: false,
      untrackedCount: 0,
      attachments: [],
      createdAt: mockIsoNow(),
      updatedAt: mockIsoNow(),
    },
    overrides,
  );
}

export const worktreePresets = {
  clean: createWorktree({ name: 'feature-login', branch: 'feature/login' }),
  dirty: createWorktree({
    name: 'fix-auth-flow',
    branch: 'fix/auth-flow',
    dirty: true,
    untrackedCount: 3,
    attachments: [
      { sessionId: mockId('sess'), title: 'Fixing auth', running: true },
    ],
  }),
  missing: createWorktree({
    name: 'old-experiment',
    branch: 'experiment/old',
    state: 'missing',
  }),
  detached: createWorktree({ name: 'detached-ref', branch: null }),
} as const;

// =============================================================================
// Git Worktree Ref Factory
// =============================================================================

export type MockRefOverrides = Partial<GitWorktreeRef>;

export function createRef(overrides: MockRefOverrides = {}): GitWorktreeRef {
  return merge<GitWorktreeRef>(
    {
      name: 'main',
      ref: 'refs/heads/main',
      kind: 'local',
      commit: 'def5678',
      current: false,
      checkedOut: false,
    },
    overrides,
  );
}

export const refPresets = {
  main: createRef({ name: 'main', current: true, checkedOut: true }),
  feature: createRef({ name: 'feature/drywall' }),
  fix: createRef({ name: 'fix/door-hinges' }),
  checkedOut: createRef({ name: 'feature/old', checkedOut: true }),
} as const;

export function createRefList(count = 5): GitWorktreeRef[] {
  return Array.from({ length: count }, (_, i) =>
    createRef({
      name: `feature/branch-${i + 1}`,
      ref: `refs/heads/feature/branch-${i + 1}`,
      current: i === 0,
      checkedOut: i === 1,
    }),
  );
}
