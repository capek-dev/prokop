import { fireEvent, render } from '@testing-library/react';
import type { Workspace } from '@prokopai/sdk';
import { describe, expect, test, vi } from 'vitest';
import { OverviewGroupSelector } from '@/components/layout/OverviewGroupSelector';
import { WorkspaceOverview } from '@/components/layout/WorkspaceOverview';
import type { OverviewGroup } from '@/config/overviewGroupsTypes';
import type { StoreActions } from '@/hooks/useOverviewGroups';

vi.mock('@/components/modals/OverviewGroupDialog', () => ({
  OverviewGroupDialog: () => null,
}));

vi.mock('@/components/ui/confirmation-dialog', () => ({
  ConfirmationDialog: () => null,
}));

const workspace = {
  id: 'workspace-1',
  name: 'Project One',
  path: '/workspace/project-one',
  additionalPaths: [],
  isVirtual: false,
  settings: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as Workspace;

const group: OverviewGroup = {
  id: 'group-1',
  serverId: 'server-1',
  name: 'My Group',
  workspaceIds: [workspace.id],
};

const groupActions = {
  selectGroup: vi.fn(),
  createGroup: vi.fn(),
  renameGroup: vi.fn(),
  setGroupWorkspaces: vi.fn(),
  deleteGroup: vi.fn(),
  reorderWorkspace: vi.fn(),
  toggleWorkspace: vi.fn(),
} as unknown as StoreActions;

describe('Overview controls', () => {
  test('styles the group selector like the compact workspace switcher', () => {
    const { getByRole } = render(
      <OverviewGroupSelector
        serverId="server-1"
        groups={[group]}
        activeGroup={group}
        workspaces={[workspace]}
        agents={[]}
        isHydrated
        actions={groupActions}
      />,
    );

    expect(getByRole('combobox', { name: 'Select overview group' })).toHaveClass(
      'h-8',
      'max-w-full',
      'self-start',
      'font-semibold',
    );
    expect(getByRole('combobox', { name: 'Select overview group' })).not.toHaveClass(
      'w-full',
      'border',
    );
  });

  test('replaces the workspace session count with a compose action', () => {
    const onCreateSessionInWorkspace = vi.fn();
    const { getByRole, queryByLabelText, queryByText } = render(
      <WorkspaceOverview
        sessionsByWorkspace={{ [workspace.id]: [] }}
        tagGroupsByWorkspace={{ [workspace.id]: new Map() }}
        orderedTagNamesByWorkspace={{ [workspace.id]: [] }}
        allWorkspaceTagsByWorkspace={{ [workspace.id]: [] }}
        childrenMap={new Map()}
        sessionDerivedValues={new Map()}
        currentSession={null}
        currentSessionId={null}
        workspaceIds={[workspace.id]}
        workspaces={[workspace]}
        agents={[]}
        activeWorkspace={workspace}
        isHydrated
        groups={[group]}
        activeGroup={group}
        groupActions={groupActions}
        serverId="server-1"
        onResumeSession={vi.fn()}
        onCloseSession={vi.fn()}
        onReopenSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onRenameSession={vi.fn()}
        onCreateSessionInWorkspace={onCreateSessionInWorkspace}
        connected
      />,
    );

    expect(queryByLabelText('0 sessions')).not.toBeInTheDocument();
    expect(queryByText('New Chat')).not.toBeInTheDocument();

    fireEvent.click(getByRole('button', { name: 'New Chat in Project One' }));

    expect(onCreateSessionInWorkspace).toHaveBeenCalledWith(
      workspace.id,
      { openAlongside: false },
    );
  });
});
