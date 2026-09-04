import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ManagedWorktree } from '@prokopai/sdk';

const mocks = vi.hoisted(() => ({
  getQueryData: vi.fn(),
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock('@/components/providers/QueryProvider', () => ({
  queryClient: mocks,
}));

import { handleWorktreeUpdated } from '@/handlers/serverMessage/worktreeHandlers';
import { queryKeys } from '@/lib/queryKeys';

function worktree(overrides: Partial<ManagedWorktree> = {}): ManagedWorktree {
  return {
    id: 'worktree-1',
    name: 'test-worktree',
    workspaceId: 'workspace-1',
    repositoryId: 'repository-1',
    path: '/repo-worktree',
    branch: 'feature/test',
    head: 'abc123',
    state: 'available',
    dirty: false,
    untrackedCount: 0,
    attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('worktree server-message handlers', () => {
  beforeEach(() => {
    mocks.getQueryData.mockReset();
    mocks.setQueryData.mockReset();
    mocks.invalidateQueries.mockReset();
  });

  test('replaces an existing worktree and refreshes the authoritative list', () => {
    const existing = worktree({ state: 'available' });
    const updated = worktree({ state: 'missing' });
    mocks.getQueryData.mockReturnValue([existing]);

    handleWorktreeUpdated(updated);

    const key = queryKeys.worktrees.byWorkspace('workspace-1');
    expect(mocks.setQueryData).toHaveBeenCalledWith(key, [updated]);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: key });
  });

  test('does not create a partial list before the initial query', () => {
    mocks.getQueryData.mockReturnValue(undefined);

    handleWorktreeUpdated(worktree());

    expect(mocks.setQueryData).not.toHaveBeenCalled();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.worktrees.byWorkspace('workspace-1'),
    });
  });
});
