import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ManagedWorktree } from '@prokopai/sdk';

const baseWorktree: ManagedWorktree = {
  id: 'wt-1',
  name: 'fix-auth',
  workspaceId: 'ws-1',
  repositoryId: 'repo-1',
  path: '/data/worktrees/fix-auth',
  branch: 'fix/auth',
  head: 'abc123',
  state: 'available',
  dirty: false,
  untrackedCount: 0,
  attachments: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let mockWorktrees: ManagedWorktree[] = [baseWorktree];
const removeMutate = vi.fn();

vi.mock('@/hooks/queries', () => ({
  useWorktreeRefsQuery: () => ({ data: [], isLoading: false }),
  useWorktreesQuery: () => ({ data: mockWorktrees, isLoading: false }),
  useWorktreeMutations: () => ({
    create: { isPending: false, mutate: vi.fn() },
    remove: { isPending: false, mutate: removeMutate },
    bind: { isPending: false, mutate: vi.fn() },
    unbind: { isPending: false, mutate: vi.fn() },
  }),
}));

import { WorktreesPanel } from '@/components/worktrees/WorktreesPanel';

describe('WorktreesPanel', () => {
  beforeEach(() => {
    mockWorktrees = [baseWorktree];
    removeMutate.mockClear();
  });

  test('lists worktrees with branch and state', () => {
    mockWorktrees = [
      baseWorktree,
      { ...baseWorktree, id: 'wt-2', name: 'gone', branch: null, state: 'missing' },
    ];
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    expect(screen.getByText('fix-auth')).toBeInTheDocument();
    expect(screen.getByText('(fix/auth)')).toBeInTheDocument();
    expect(screen.getByText('missing')).toBeInTheDocument();
    expect(screen.getByText('Directory is missing')).toBeInTheDocument();
  });

  test('shows the inline create form from the + button', async () => {
    const user = userEvent.setup();
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    await user.click(screen.getByRole('button', { name: 'New worktree' }));

    expect(screen.getByPlaceholderText('Search branches…')).toBeInTheDocument();
    expect(screen.getByLabelText('Worktree name')).toBeInTheDocument();
  });

  test('remove is blocked with the reason inline', async () => {
    const user = userEvent.setup();
    mockWorktrees = [{
      ...baseWorktree,
      dirty: true,
      attachments: [{ sessionId: 's1', title: 'Auth work', running: true }],
    }];
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    expect(screen.getByText(/Has uncommitted changes/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for fix-auth' }));
    expect(screen.getByRole('menuitem', { name: /Remove/ })).toHaveAttribute('aria-disabled', 'true');
  });

  test('idle attached sessions do not block removal and render as info', async () => {
    const user = userEvent.setup();
    mockWorktrees = [{
      ...baseWorktree,
      attachments: [{ sessionId: 's1', title: 'Auth work', running: false }],
    }];
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    expect(screen.getByText('1 session attached')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for fix-auth' }));
    const removeItem = screen.getByRole('menuitem', { name: /Remove/ });
    expect(removeItem).toBeEnabled();
    await user.click(removeItem);

    expect(removeMutate).toHaveBeenCalledWith('wt-1', expect.anything());
  });

  test('remove fires immediately for a clean worktree', async () => {
    const user = userEvent.setup();
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    await user.click(screen.getByRole('button', { name: 'Actions for fix-auth' }));
    await user.click(screen.getByRole('menuitem', { name: /Remove/ }));

    expect(removeMutate).toHaveBeenCalledWith('wt-1', expect.anything());
  });

  test('removed records offer purge and stay listed', async () => {
    const user = userEvent.setup();
    mockWorktrees = [{ ...baseWorktree, state: 'removed' }];
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    await user.click(screen.getByRole('button', { name: 'Actions for fix-auth' }));
    expect(screen.getByRole('menuitem', { name: /Purge record/ })).toBeEnabled();

    await user.click(screen.getByRole('menuitem', { name: /Purge record/ }));
    expect(removeMutate).toHaveBeenCalledWith('wt-1', expect.anything());
  });

  test('shows the empty state when there are no worktrees', () => {
    mockWorktrees = [];
    render(<WorktreesPanel sdkClient={null} workspaceId="ws-1" />);

    expect(screen.getByText('No worktrees yet')).toBeInTheDocument();
  });
});
