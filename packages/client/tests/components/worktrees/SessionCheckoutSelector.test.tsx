import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ManagedWorktree, Session } from '@prokopai/sdk';

const worktrees: ManagedWorktree[] = [
  {
    id: 'worktree-1',
    name: 'fix-auth',
    workspaceId: 'workspace-1',
    repositoryId: 'repository-1',
    path: '/data/worktrees/fix-auth',
    branch: 'fix/auth',
    head: 'abc123',
    state: 'available',
    dirty: false,
    untrackedCount: 0,
    attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

let mockWorktrees: ManagedWorktree[] = [...worktrees];
const bindMutate = vi.fn();
const unbindMutate = vi.fn();

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
  useWorktreesQuery: () => ({ data: mockWorktrees, isLoading: false }),
  useWorktreeMutations: () => ({
    create: { isPending: false, mutate: vi.fn() },
    bind: { isPending: false, mutate: bindMutate },
    unbind: { isPending: false, mutate: unbindMutate },
  }),
}));

import {
  SessionCheckoutSelector,
  SessionCheckoutStrip,
} from '@/components/worktrees/SessionCheckoutSelector';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    workspaceId: 'workspace-1',
    workspaceRootId: null,
    parentId: null,
    status: 'active',
    ...overrides,
  } as Session;
}

describe('SessionCheckoutSelector', () => {
  beforeEach(() => {
    mockWorktrees = [...worktrees];
    bindMutate.mockClear();
  });

  test('keeps worktree management available when the workspace has no worktrees', async () => {
    mockWorktrees = [];
    const user = userEvent.setup();
    render(<SessionCheckoutSelector session={makeSession()} sdkClient={null} />);

    await user.click(screen.getByRole('button', { name: /Primary checkout/ }));
    expect(screen.getByRole('option', { name: /New worktree/ })).toBeInTheDocument();
  });

  test('shows the primary checkout label and opens the searchable list', async () => {
    const user = userEvent.setup();
    render(<SessionCheckoutSelector session={makeSession()} sdkClient={null} />);

    const trigger = screen.getByRole('button', { name: /Primary checkout/ });
    expect(trigger).toBeInTheDocument();

    await user.click(trigger);
    expect(screen.getByPlaceholderText('Search worktrees…')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /fix-auth/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Primary checkout/ })).toBeInTheDocument();
  });

  test('binds immediately on selection without a confirm step', async () => {
    const user = userEvent.setup();
    render(<SessionCheckoutSelector session={makeSession()} sdkClient={null} />);

    await user.click(screen.getByRole('button', { name: /Primary checkout/ }));
    await user.click(screen.getByRole('option', { name: /fix-auth/ }));

    expect(bindMutate).toHaveBeenCalledWith(
      { sessionId: 'session-1', worktreeId: 'worktree-1' },
      expect.anything(),
    );
  });

  test('opens the inline create pane from the popover', async () => {
    const user = userEvent.setup();
    render(<SessionCheckoutSelector session={makeSession()} sdkClient={null} />);

    await user.click(screen.getByRole('button', { name: /Primary checkout/ }));
    await user.click(screen.getByRole('option', { name: /New worktree/ }));

    expect(screen.getByPlaceholderText('Search branches…')).toBeInTheDocument();
    expect(screen.getByLabelText('Worktree name')).toHaveValue('feature/available');
  });
});

describe('SessionCheckoutStrip', () => {
  beforeEach(() => {
    mockWorktrees = [...worktrees];
    bindMutate.mockClear();
    unbindMutate.mockClear();
  });

  test('renders nothing when the session is not bound to a worktree', () => {
    const { container } = render(
      <SessionCheckoutStrip session={makeSession()} sdkClient={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('shows the bound worktree and branch only', () => {
    mockWorktrees = [{
      ...worktrees[0],
      dirty: true,
      attachments: [{ sessionId: 's1', title: 'Fixing auth', running: true }],
    }];
    render(
      <SessionCheckoutStrip
        session={makeSession({ workspaceRootId: 'worktree-1' })}
        sdkClient={null}
      />,
    );

    const strip = screen.getByRole('button', { name: /fix-auth/ });
    expect(strip).toHaveTextContent('fix-auth');
    expect(strip).toHaveTextContent('fix/auth');
    // Health/session stats no longer render on the strip.
    expect(strip).not.toHaveTextContent('session');
    expect(strip.querySelector('.bg-warning')).toBeNull();
  });

  test('flags an unavailable bound worktree', () => {
    mockWorktrees = [{ ...worktrees[0], state: 'missing' }];
    render(
      <SessionCheckoutStrip
        session={makeSession({ workspaceRootId: 'worktree-1' })}
        sdkClient={null}
      />,
    );

    const strip = screen.getByRole('button', { name: /fix-auth/ });
    expect(strip).toHaveTextContent('unavailable (missing)');
  });

  test('locked strip renders as a non-interactive label', () => {
    render(
      <SessionCheckoutStrip
        session={makeSession({ workspaceRootId: 'worktree-1' })}
        sdkClient={null}
        locked
      />,
    );

    expect(screen.getByText('fix-auth')).toBeInTheDocument();
    expect(screen.getByText(/fix\/auth/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fix-auth/ })).not.toBeInTheDocument();
  });

  test('opens the shared checkout menu and rebinds', async () => {
    const user = userEvent.setup();
    render(
      <SessionCheckoutStrip
        session={makeSession({ workspaceRootId: 'worktree-1' })}
        sdkClient={null}
      />,
    );

    await user.click(screen.getByRole('button', { name: /fix-auth/ }));
    await user.click(screen.getByRole('option', { name: /Primary checkout/ }));

    expect(unbindMutate).toHaveBeenCalledWith('session-1', expect.anything());
  });
});
