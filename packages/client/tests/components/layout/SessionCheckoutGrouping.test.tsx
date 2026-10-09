import type { ComponentProps } from 'react';
import type { ManagedWorktree, Session } from '@prokopai/sdk';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { WorkspaceSessionContent } from '@/components/layout/WorkspaceSessionContent';

vi.mock('@/components/layout/SessionMenuButton', () => ({
  SessionMenuButton: ({ session, hideWorktreeChip }: { session: Session; hideWorktreeChip?: boolean }) => (
    <li data-testid="session" data-chip={hideWorktreeChip ? 'hidden' : 'shown'}>{session.id}</li>
  ),
}));
vi.mock('@/components/layout/ScheduledJobsSection', () => ({ ScheduledJobsSection: () => null }));
vi.mock('@/components/ui/confirmation-dialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@/hooks/useTagCollapseState', () => ({ useTagCollapseState: () => ({ isTagOpen: () => true, toggleTag: vi.fn() }) }));
vi.mock('@/contexts/ServerClientContext', () => ({ useSdkClient: () => null }));
vi.mock('@/hooks/queries', () => ({
  useWorktreesQuery: () => ({ data: [{ id: 'w1', name: 'auth-fix', state: 'available' } as ManagedWorktree] }),
}));

const main = { id: 'main-session', tags: [], workspaceRootId: null } as unknown as Session;
const inWorktree = { id: 'worktree-session', tags: [], workspaceRootId: 'w1' } as unknown as Session;

const props: ComponentProps<typeof WorkspaceSessionContent> = {
  workspaceId: 'ws1',
  activeSessions: [inWorktree, main], archivedSessions: [], scheduledJobs: [],
  scheduledSessionsByJob: new Map(), childrenMap: new Map(), sessionDerivedValues: new Map(),
  currentSessionId: null, tagGroups: new Map([['__ungrouped__', [inWorktree, main]]]), orderedTagNames: [], allWorkspaceTags: [],
  onResumeSession: vi.fn(), onCloseSession: vi.fn(), onReopenSession: vi.fn(),
  onDeleteSession: vi.fn(), onRenameSession: vi.fn(), onBulkCloseSessions: vi.fn(), onBulkDeleteSessions: vi.fn(),
  onAddTag: vi.fn(), onRemoveTag: vi.fn(), onCreateScheduledJob: vi.fn(), onEditScheduledJob: vi.fn(),
  onPauseScheduledJob: vi.fn(), onResumeScheduledJob: vi.fn(), onTriggerScheduledJob: vi.fn(), onDeleteScheduledJob: vi.fn(),
};

describe('group by checkout', () => {
  beforeEach(() => localStorage.clear());

  test('groups sessions under their checkout and remembers the choice per workspace', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<WorkspaceSessionContent {...props} />);
    expect(screen.queryByText('Main checkout')).toBeNull();
    expect(screen.getAllByTestId('session').map((row) => row.dataset.chip)).toEqual(['shown', 'shown']);

    await user.click(screen.getByRole('button', { name: 'Session actions' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Checkout' }));

    expect(screen.getByText('Main checkout')).toBeVisible();
    expect(screen.getByText('auth-fix')).toBeVisible();
    expect(screen.getAllByTestId('session').map((row) => [row.textContent, row.dataset.chip])).toEqual([
      ['main-session', 'hidden'],
      ['worktree-session', 'hidden'],
    ]);

    unmount();
    render(<WorkspaceSessionContent {...props} />);
    expect(screen.getByText('Main checkout')).toBeVisible();
  });

  test('another workspace keeps its own grouping', async () => {
    localStorage.setItem('prokopai_session_grouping', JSON.stringify({ ws1: 'checkout' }));
    render(<WorkspaceSessionContent {...props} workspaceId="ws2" />);
    expect(screen.queryByText('Main checkout')).toBeNull();
  });
});
