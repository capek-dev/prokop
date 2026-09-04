import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { WorktreeCreateForm } from '@/components/worktrees/WorktreeCreateForm';

const refs = [
  {
    name: 'feature/available',
    ref: 'refs/heads/feature/available',
    kind: 'local' as const,
    commit: 'def456',
    current: false,
    checkedOut: false,
  },
  {
    name: 'main',
    ref: 'refs/heads/main',
    kind: 'local' as const,
    commit: 'abc123',
    current: true,
    checkedOut: true,
  },
];

describe('WorktreeCreateForm', () => {
  test('defaults to the first free branch and prefills the worktree name', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <WorktreeCreateForm
        refs={refs}
        existingWorktreeNames={[]}
        refsLoading={false}
        pending={false}
        onCreate={onCreate}
      />,
    );

    const worktreeName = screen.getByLabelText('Worktree name');
    expect(worktreeName).toHaveValue('feature/available');

    await user.clear(worktreeName);
    await user.type(worktreeName, 'available-work');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(onCreate).toHaveBeenCalledWith(
      { name: 'available-work', branch: 'refs/heads/feature/available' },
      expect.any(Function),
    );
  });

  test('adds a suffix only when the default worktree name already exists', () => {
    render(
      <WorktreeCreateForm
        refs={refs}
        existingWorktreeNames={['feature/available', 'feature/available-2']}
        refsLoading={false}
        pending={false}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Worktree name')).toHaveValue('feature/available-3');
  });

  test('warns about an existing worktree name and blocks creation', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <WorktreeCreateForm
        refs={refs}
        existingWorktreeNames={['existing-worktree']}
        refsLoading={false}
        pending={false}
        onCreate={onCreate}
      />,
    );

    const worktreeName = screen.getByLabelText('Worktree name');
    await user.clear(worktreeName);
    await user.type(worktreeName, 'existing-worktree');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A worktree named "existing-worktree" already exists.',
    );
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  test('does not offer remote branches and marks checked-out local branches unavailable', () => {
    render(
      <WorktreeCreateForm
        refs={[
          ...refs,
          {
            name: 'origin/remote-only',
            ref: 'refs/remotes/origin/remote-only',
            kind: 'remote',
            commit: 'fed987',
            current: false,
            checkedOut: false,
          },
        ]}
        existingWorktreeNames={[]}
        refsLoading={false}
        pending={false}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.queryByText(/remote-only/)).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /main/ })).toHaveAttribute('aria-disabled', 'true');
  });
});
