import type { ComponentProps } from 'react';
import type { Session, Workspace } from '@prokopai/sdk';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { WorkspaceSessionContent } from '@/components/layout/WorkspaceSessionContent';
import { WorkspaceOverview } from '@/components/layout/WorkspaceOverview';

vi.mock('@/components/layout/SessionMenuButton', () => ({
  SessionMenuButton: ({ session }: { session: Session }) => <li data-testid="session">{session.id}</li>,
}));
vi.mock('@/components/layout/ScheduledJobsSection', () => ({ ScheduledJobsSection: () => null }));
vi.mock('@/components/layout/OverviewGroupSelector', () => ({ OverviewGroupSelector: () => null }));
vi.mock('@/components/ui/confirmation-dialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@/hooks/useTagCollapseState', () => ({ useTagCollapseState: () => ({ isTagOpen: () => true, toggleTag: vi.fn() }) }));
vi.mock('@/hooks/useWorkspaceCollapseState', () => ({ useWorkspaceCollapseState: () => ({ isWorkspaceOpen: () => true, toggleWorkspace: vi.fn() }) }));

const tagged = { id: 'tagged', tags: ['work'] } as Session;
const untagged = { id: 'untagged', tags: [] } as unknown as Session;
const tagGroups = new Map([['work', [tagged]], ['__ungrouped__', [untagged]]]);
const panelProps: ComponentProps<typeof WorkspaceSessionContent> = {
  activeSessions: [tagged, untagged], archivedSessions: [], scheduledJobs: [],
  scheduledSessionsByJob: new Map(), childrenMap: new Map(), sessionDerivedValues: new Map(),
  currentSessionId: null, tagGroups, orderedTagNames: ['work'], allWorkspaceTags: ['work'],
  onResumeSession: vi.fn(), onCloseSession: vi.fn(), onReopenSession: vi.fn(),
  onDeleteSession: vi.fn(), onRenameSession: vi.fn(), onBulkCloseSessions: vi.fn(), onBulkDeleteSessions: vi.fn(),
  onAddTag: vi.fn(), onRemoveTag: vi.fn(), onCreateScheduledJob: vi.fn(), onEditScheduledJob: vi.fn(),
  onPauseScheduledJob: vi.fn(), onResumeScheduledJob: vi.fn(), onTriggerScheduledJob: vi.fn(), onDeleteScheduledJob: vi.fn(),
};

function visibleSessions() {
  return screen.getAllByTestId('session').map(element => element.textContent);
}

describe('session panel ordering', () => {
  test('updates rendered ordering when workspace preference changes', () => {
    const { rerender } = render(<WorkspaceSessionContent {...panelProps} />);
    expect(visibleSessions()).toEqual(['tagged', 'untagged']);
    rerender(<WorkspaceSessionContent {...panelProps} sessionTagOrder="untagged-first" />);
    expect(visibleSessions()).toEqual(['untagged', 'tagged']);
    rerender(<WorkspaceSessionContent {...panelProps} />);
    expect(visibleSessions()).toEqual(['tagged', 'untagged']);
  });

  test('quick menu exposes selected ordering and changes it without collapsing Active', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorkspaceSessionContent {...panelProps} onSessionTagOrderChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Session actions' }));
    expect(screen.getByRole('menuitemradio', { name: 'Tagged first' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitemradio', { name: 'Untagged first' }));
    expect(onChange).toHaveBeenCalledWith('untagged-first');
    expect(screen.getByText('untagged')).toBeVisible();
  });

  test('overview applies each workspace preference independently', () => {
    const workspaces = [
      { id: 'one', name: 'One', settings: { sessionTagOrder: 'untagged-first' } },
      { id: 'two', name: 'Two', settings: {} },
    ] as Workspace[];
    render(<WorkspaceOverview
      {...panelProps}
      sessionsByWorkspace={{ one: [tagged, untagged], two: [tagged, untagged] }}
      tagGroupsByWorkspace={{ one: tagGroups, two: tagGroups }}
      orderedTagNamesByWorkspace={{ one: ['work'], two: ['work'] }}
      allWorkspaceTagsByWorkspace={{ one: ['work'], two: ['work'] }}
      workspaceIds={['one', 'two']} workspaces={workspaces} agents={[]}
      activeWorkspace={workspaces[0]} currentSession={null} isHydrated
      groups={[{ id: 'group', serverId: 'server', name: 'Group', workspaceIds: ['one', 'two'] }]}
      activeGroup={null} groupActions={{} as ComponentProps<typeof WorkspaceOverview>['groupActions']}
      serverId="server" onCreateSessionInWorkspace={vi.fn()} connected
    />);
    expect(visibleSessions()).toEqual(['untagged', 'tagged', 'tagged', 'untagged']);
  });
});
