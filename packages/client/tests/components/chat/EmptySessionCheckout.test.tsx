import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { ManagedWorktree, Session } from '@prokopai/sdk';

const worktree: ManagedWorktree = {
  id: 'worktree-1',
  name: 'existing-worktree',
  workspaceId: 'workspace-1',
  repositoryId: 'repository-1',
  path: '/data/worktrees/worktree-1',
  branch: 'feature/existing',
  head: 'abc123',
  state: 'available',
  dirty: false,
  untrackedCount: 0,
  attachments: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

vi.mock('@/hooks/queries', () => ({
  useWorktreeRefsQuery: () => ({
    data: [{
      name: 'feature/available',
      ref: 'refs/heads/feature/available',
      kind: 'local',
      commit: 'abc123',
      current: false,
      checkedOut: false,
    }],
    isLoading: false,
  }),
  useWorktreesQuery: () => ({ data: [worktree], isLoading: false }),
  useWorktreeMutations: () => ({
    create: { isPending: false, mutate: vi.fn() },
    bind: { isPending: false, mutate: vi.fn() },
    unbind: { isPending: false, mutate: vi.fn() },
  }),
}));

import { EmptySessionCheckout } from '@/components/chat/EmptySessionCheckout';

const session = {
  id: 'session-1',
  workspaceId: 'workspace-1',
  workspaceRootId: null,
  parentId: null,
  status: 'active',
} as Session;

describe('EmptySessionCheckout', () => {
  test('offers worktree creation inside the checkout selector', async () => {
    const user = userEvent.setup();
    render(<EmptySessionCheckout session={session} sdkClient={null} />);

    expect(screen.getByText('Start a conversation')).toBeInTheDocument();
    const checkout = screen.getByRole('combobox', { name: 'Session checkout' });
    expect(checkout).toHaveTextContent('Primary checkout');
    expect(screen.queryByRole('button', { name: 'New worktree' })).not.toBeInTheDocument();

    await user.click(checkout);
    await user.click(screen.getByRole('option', { name: 'New worktree' }));

    const createFrom = screen.getByRole('combobox', { name: 'Create from' });
    const worktreeName = screen.getByLabelText('Worktree name');
    expect(createFrom).toHaveTextContent('feature/available');
    expect(worktreeName).toHaveValue('feature/available');
    expect(createFrom.compareDocumentPosition(worktreeName) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
