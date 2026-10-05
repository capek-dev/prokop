import { createRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Session, Workspace } from '@prokopai/sdk';
import { FilesPanel, type FilesPanelHandle } from '@/components/layout/FilesPanel';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';
import { createDefaultViewLayout, findViewRegion, useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useDockStore } from '@/stores/dockStore';

const mocks = vi.hoisted(() => ({ gitStatus: vi.fn(), mobile: false }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ serverId: 'server' }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mocks.mobile }));
vi.mock('@/hooks/queries', () => ({
  useWorktreesQuery: () => ({ data: [], isLoading: false }),
  useWorktreeMutations: () => ({ unbind: { isPending: false }, bind: { isPending: false } }),
}));
vi.mock('@/hooks/queries/useFileQueries', () => ({
  useGitStatusQuery: (...args: unknown[]) => { mocks.gitStatus(...args); return {}; },
}));
vi.mock('@/components/files', () => ({
  FileTree: ({ root }: { root?: string }) => <input aria-label="Explorer contents" data-root={root ?? 'primary'} defaultValue="" />,
  GitChangesView: ({ root }: { root?: string }) => <div data-testid="changes" data-root={root ?? 'primary'} />,
}));
vi.mock('@/components/files/GitChangesView', () => ({
  summarizeDiffStats: () => ({ fileCount: 0, additions: 0, deletions: 0, hasCounts: false }),
}));
vi.mock('@/components/files/BranchesPanel', () => ({
  BranchesPanel: ({ root }: { root?: string }) => <div data-testid="branches" data-root={root ?? 'primary'} />,
}));
vi.mock('@/components/worktrees/WorktreesPanel', () => ({ WorktreesPanel: () => null }));
vi.mock('@/components/worktrees/SessionCheckoutSelector', () => ({ CheckoutMenu: () => null }));

const workspace = { id: 'workspace', path: '/primary', name: 'Project', additionalPaths: ['/extra'] } as Workspace;

describe('independent repository content', () => {
  beforeEach(() => {
    mocks.mobile = false;
    mocks.gitStatus.mockClear();
    useChatLayoutStore.setState(useChatLayoutStore.getInitialState());
    useServerDataStore.setState({ serverId: 'server', activeWorkspace: workspace });
    useSessionBoardStore.setState({ focusedSessionId: 'session' });
    useSessionStore.setState({ sessions: [{ id: 'session', workspaceId: 'workspace', workspaceRootId: null } as Session] });
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
    useDockStore.setState(useDockStore.getInitialState());
  });
  afterEach(() => {
    cleanup();
    useChatLayoutStore.setState(useChatLayoutStore.getInitialState());
    useServerDataStore.setState(useServerDataStore.getInitialState());
    useSessionBoardStore.setState(useSessionBoardStore.getInitialState());
    useSessionStore.setState(useSessionStore.getInitialState());
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
    useDockStore.setState(useDockStore.getInitialState());
    localStorage.clear();
  });

  test('fixed views ignore legacy tab selection and share the focused session root pin', () => {
    render(<>
      <FilesPanel sdkClient={null} view="explorer" embedded />
      <FilesPanel sdkClient={null} view="changes" embedded />
      <FilesPanel sdkClient={null} view="branches" embedded />
    </>);
    const explorer = screen.getByRole('textbox');
    expect(screen.queryByRole('tablist')).toBeNull();
    act(() => {
      useChatLayoutStore.getState().setFilesPanelTab('worktrees');
      useChatLayoutStore.getState().setFilesPanelRoot('/extra');
      useChatLayoutStore.getState().setFilesPanelRootPinned(true);
    });
    expect(screen.getByRole('textbox')).toHaveAttribute('data-root', '/extra');
    expect(screen.getByTestId('changes')).toHaveAttribute('data-root', '/extra');
    expect(screen.getByTestId('branches')).toHaveAttribute('data-root', '/extra');
    // Root changes intentionally replace the tree; tool selection does not.
    expect(screen.getByRole('textbox')).not.toBe(explorer);
    const pinnedExplorer = screen.getByRole('textbox');
    act(() => useChatLayoutStore.getState().setFilesPanelTab('branches'));
    expect(screen.getByRole('textbox')).toBe(pinnedExplorer);
    act(() => useSessionBoardStore.setState({ focusedSessionId: 'other-session' }));
    expect(screen.getByRole('textbox')).toHaveAttribute('data-root', 'primary');
    expect(screen.getByTestId('changes')).toHaveAttribute('data-root', 'primary');
    expect(screen.getByTestId('branches')).toHaveAttribute('data-root', 'primary');
  });

  test('all root-scoped views block an unavailable worktree without querying primary status', () => {
    useSessionStore.setState({ sessions: [{ id: 'session', workspaceId: 'workspace', workspaceRootId: 'missing' } as Session] });
    render(<>
      <FilesPanel sdkClient={null} view="explorer" embedded />
      <FilesPanel sdkClient={null} view="changes" embedded />
      <FilesPanel sdkClient={null} view="branches" embedded />
    </>);
    expect(screen.getAllByText("This session's worktree is unavailable")).toHaveLength(3);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByTestId('changes')).toBeNull();
    expect(screen.queryByTestId('branches')).toBeNull();
    expect(mocks.gitStatus.mock.calls.every((args) => args[1] === undefined && args[3] === false)).toBe(true);
  });

  test('Explorer focus restores its moved instance and selects Explorer on mobile', () => {
    const ref = createRef<FilesPanelHandle>();
    const { rerender } = render(<FilesPanel ref={ref} sdkClient={null} view="explorer" embedded />);
    act(() => {
      useWorkspaceViewStore.getState().moveView('explorer', 'bottom');
      useWorkspaceViewStore.getState().hideView('explorer');
      ref.current?.focus();
    });
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, 'explorer')).toBe('bottom');
    expect(useWorkspaceViewStore.getState().layout.hidden).not.toContain('explorer');
    expect(useDockStore.getState().docks.bottom.open).toBe(true);
    mocks.mobile = true;
    act(() => useChatLayoutStore.getState().setFilesPanelTab('branches'));
    rerender(<FilesPanel ref={ref} sdkClient={null} view="explorer" embedded />);
    act(() => ref.current?.focus());
    expect(useChatLayoutStore.getState().mobileSurface).toBe('files');
    expect(useChatLayoutStore.getState().sessionFilesLayouts[JSON.stringify(['server', 'workspace', 'session'])].filesPanelTab).toBe('project');
  });
});
