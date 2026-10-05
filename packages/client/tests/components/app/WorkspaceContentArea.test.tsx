import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Session, Workspace } from '@prokopai/sdk';
import { WorkspaceContentArea } from '@/components/app/WorkspaceContentArea';
import type { FilesPanelHandle } from '@/components/layout/FilesPanel';
import { ViewRefsContext, type ViewRefs } from '@/contexts/ViewRefsContext';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useFileEditorStore } from '@/stores/fileEditorStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { createDefaultViewLayout, useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useDockStore } from '@/stores/dockStore';

const viewport = vi.hoisted(() => ({ mobile: true, compact: true }));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ serverId: 'server-1' }),
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { pathname: '/server/server-1/workspace/session/session-1' } }),
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => viewport.mobile,
  useIsCompact: () => viewport.compact,
}));

vi.mock('@/components/board/SessionPane', () => ({
  SessionPane: () => <div data-testid="chat-content" />,
}));

vi.mock('@/components/layout/FilesPanel', async () => {
  const { useChatLayoutStore: layoutStore } = await import('@/stores/chatLayoutStore');
  return {
    FilesPanel: forwardRef<FilesPanelHandle, { view?: string }>(function MockFilesPanel({ view }, ref) {
      useImperativeHandle(ref, () => ({
        focus: () => layoutStore.getState().setMobileSurface('files'),
      }), []);
      return (
        <div data-testid={view === 'explorer' ? 'files-content' : view}>
          <button type="button" onClick={() => layoutStore.getState().setMobileSurface('chat')}>
            Chat
          </button>
        </div>
      );
    }),
  };
});

vi.mock('@/components/worktrees/WorktreesPanel', () => ({ WorktreesPanel: () => <div data-testid="worktrees" /> }));

vi.mock('@/components/editor/FileEditorSurface', () => ({
  FileEditorSurface: () => <div data-testid="editor-content" />,
}));

vi.mock('@/hooks/queries', () => ({
  useWorktreesQuery: () => ({ data: [], isLoading: false }),
}));

function createViewRefs(): ViewRefs {
  return {
    sidebarRef: createRef(),
    chatInputRef: createRef(),
    terminalPanelRef: createRef(),
    filesPanelRef: createRef(),
    scrollToBottomRef: createRef(),
    autoFollowToggleRef: createRef(),
  };
}

const workspace = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/workspace',
  additionalPaths: [],
  isVirtual: false,
  settings: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as Workspace;

describe('WorkspaceContentArea responsive surfaces', () => {
  beforeEach(() => {
    useSessionBoardStore.setState({ openSessionIds: ['session-1'], focusedSessionId: 'session-1' });
    useSessionStore.setState({ sessions: [{ id: 'session-1', workspaceId: 'workspace-1', title: 'Session one' } as Session] });
    useServerDataStore.setState({ serverId: 'server-1' });
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
    viewport.mobile = true;
    viewport.compact = true;
    useDockStore.setState(useDockStore.getInitialState());
    useChatLayoutStore.setState({
      filesPanelTab: 'project',
      sessionFilesLayouts: {},
      workbenchSurface: 'explorer',
      mobileSurface: 'chat',
    });
    useFileEditorStore.setState({
      docs: {},
      openDocIds: [],
      activeDocId: null,
      anyDirty: false,
    });
    useServerDataStore.setState({
      activeWorkspace: workspace,
      workspaces: [workspace],
    });
  });

  afterEach(() => { cleanup(); localStorage.clear(); });

  test('places the desktop workbench in the right dock and preserves content when collapsed', () => {
    viewport.mobile = false;
    viewport.compact = false;
    const { getByTestId } = render(
      <ViewRefsContext.Provider value={createViewRefs()}>
        <WorkspaceContentArea sdkClient={null} serverUrl={null} />
      </ViewRefsContext.Provider>,
    );
    const chat = getByTestId('chat-content');
    const files = getByTestId('files-content');
    const right = files.closest('[data-dock-position="right"]');
    expect(right).toHaveAttribute('inert');
    expect(right).not.toContainElement(chat);
    act(() => useDockStore.getState().setDockOpen('right', true));
    expect(right).not.toHaveAttribute('inert');
    act(() => useDockStore.getState().setDockOpen('right', false));
    expect(right).toHaveAttribute('inert');
    expect(getByTestId('files-content')).toBe(files);
    expect(getByTestId('chat-content')).toBe(chat);
  });

  test('uses peer Workbench tabs on phone and keeps their content mounted', () => {
    const { getByRole, getByTestId } = render(
      <ViewRefsContext.Provider value={createViewRefs()}>
        <WorkspaceContentArea sdkClient={null} serverUrl={null} />
      </ViewRefsContext.Provider>,
    );

    const chatSurface = getByTestId('chat-content').closest('[data-workspace-view="session:server-1:session-1"]');
    const workbenchSurface = getByTestId('files-content').closest('[data-workspace-view="explorer"]');
    expect(chatSurface).toHaveAttribute('aria-hidden', 'false');
    expect(workbenchSurface).toHaveAttribute('aria-hidden', 'true');

    act(() => useChatLayoutStore.getState().setMobileSurface('files'));

    expect(chatSurface).toHaveAttribute('aria-hidden', 'true');
    expect(workbenchSurface).toHaveAttribute('aria-hidden', 'false');
    expect(getByRole('tab', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'true');
    expect(getByRole('tab', { name: 'Changes' })).toBeInTheDocument();

    act(() => {
      useFileEditorStore.getState().openDoc(
        {
          serverId: 'server-1',
          workspaceId: 'workspace-1',
          root: '',
          path: 'src/index.ts',
        },
        'index.ts',
      );
    });

    const editorContent = getByTestId('editor-content');
    const editorTab = getByRole('button', { name: 'Editor' });

    fireEvent.click(editorTab);

    expect(chatSurface).toHaveAttribute('aria-hidden', 'true');
    expect(workbenchSurface).toHaveAttribute('aria-hidden', 'true');
    expect(editorContent.parentElement).toHaveAttribute('aria-hidden', 'false');

    fireEvent.click(getByRole('button', { name: 'Files' }));
    fireEvent.click(getByRole('tab', { name: 'Changes' }));
    expect(useChatLayoutStore.getState().mobileSurface).toBe('files');
    expect(useChatLayoutStore.getState().sessionFilesLayouts[JSON.stringify(['server-1', 'workspace-1', 'session-1'])].filesPanelTab).toBe('changes');
    expect(getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true');
    expect(editorContent.parentElement).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(getByRole('tab', { name: 'Explorer' }));
    expect(useChatLayoutStore.getState().sessionFilesLayouts[JSON.stringify(['server-1', 'workspace-1', 'session-1'])].filesPanelTab).toBe('project');
    expect(getByRole('tab', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(getByRole('button', { name: 'Back to Chat' }));
    expect(chatSurface).toHaveAttribute('aria-hidden', 'false');
    expect(workbenchSurface).toHaveAttribute('aria-hidden', 'true');
    expect(getByTestId('files-content')).toBeInTheDocument();
    expect(getByTestId('editor-content')).toBe(editorContent);
  });

  test('repository tools have separate hosts and remain independently visible across docks and mobile', () => {
    viewport.mobile = false;
    viewport.compact = false;
    const refs = createViewRefs();
    const content = <ViewRefsContext.Provider value={refs}><WorkspaceContentArea sdkClient={null} serverUrl={null} /></ViewRefsContext.Provider>;
    const { getByTestId, getAllByRole, rerender } = render(content);
    const explorer = getByTestId('files-content');
    const changes = getByTestId('changes');
    const branches = getByTestId('branches');
    const worktrees = getByTestId('worktrees');
    act(() => {
      useWorkspaceViewStore.getState().moveView('explorer', 'left');
      useWorkspaceViewStore.getState().moveView('changes', 'center');
      useWorkspaceViewStore.getState().moveView('branches', 'right');
      useWorkspaceViewStore.getState().moveView('worktrees', 'bottom');
    });
    for (const [element, id, region, label] of [
      [explorer, 'explorer', 'left', 'Explorer'], [changes, 'changes', 'center', 'Changes'],
      [branches, 'branches', 'right', 'Branches'], [worktrees, 'worktrees', 'bottom', 'Worktrees'],
    ] as const) {
      expect(element.closest('[data-workspace-view]')).toHaveAttribute('aria-hidden', 'false');
      expect(element.closest('[data-view-group]')).toHaveAttribute('data-view-group', region);
      expect(document.querySelectorAll(`[data-workspace-view="${id}"]`)).toHaveLength(1);
      expect(getAllByRole('tab', { name: label })).toHaveLength(1);
    }
    viewport.mobile = true;
    act(() => {
      useChatLayoutStore.getState().setFilesPanelTab('worktrees');
      useChatLayoutStore.getState().setMobileSurface('files');
    });
    rerender(<ViewRefsContext.Provider value={refs}><WorkspaceContentArea sdkClient={null} serverUrl={null} /></ViewRefsContext.Provider>);
    expect(getByTestId('worktrees')).toBe(worktrees);
    expect(worktrees.closest('[data-workspace-view]')).toHaveAttribute('aria-hidden', 'false');
    expect(explorer.closest('[data-workspace-view]')).toHaveAttribute('aria-hidden', 'true');
    expect(changes.closest('[data-workspace-view]')).toHaveAttribute('aria-hidden', 'true');
  });

  test('keeps Chat mounted while Sessions opens and returns to Chat', () => {
    useChatLayoutStore.setState({ mobileSurface: 'chat' });

    const { container, getByRole, getByTestId } = render(
      <ViewRefsContext.Provider value={createViewRefs()}>
        <WorkspaceContentArea
          sdkClient={null}
          serverUrl={null}
          sessionsContent={(
            <button type="button" data-testid="session-row">
              Session one
            </button>
          )}
        />
      </ViewRefsContext.Provider>,
    );

    const chatSurface = getByTestId('chat-content').closest('[data-workspace-view="session:server-1:session-1"]');
    act(() => useChatLayoutStore.getState().setMobileSurface('sessions'));
    const sessionsSurface = getByTestId('session-row').closest('[data-workspace-view="sessions"]');
    expect(chatSurface).toHaveAttribute('aria-hidden', 'true');
    expect(chatSurface).toHaveAttribute('inert');
    expect(sessionsSurface).toHaveAttribute('aria-hidden', 'false');
    expect(sessionsSurface).not.toHaveAttribute('inert');
    expect(container.querySelectorAll('[data-workspace-view="sessions"]')).toHaveLength(1);
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Back to Chat' }));

    expect(useChatLayoutStore.getState().mobileSurface).toBe('chat');
    expect(chatSurface).toHaveAttribute('aria-hidden', 'false');
    expect(sessionsSurface).toHaveAttribute('aria-hidden', 'true');
    expect(sessionsSurface).toHaveAttribute('inert');
    expect(getByTestId('session-row')).toBeInTheDocument();
  });

  test('returns to files when the last editor document closes', async () => {
    act(() => {
      const docId = useFileEditorStore.getState().openDoc(
        {
          serverId: 'server-1',
          workspaceId: 'workspace-1',
          root: '',
          path: 'src/index.ts',
        },
        'index.ts',
      );
      useChatLayoutStore.getState().setMobileSurface('editor');
      useFileEditorStore.getState().closeDoc(docId);
    });

    render(
      <ViewRefsContext.Provider value={createViewRefs()}>
        <WorkspaceContentArea sdkClient={null} serverUrl={null} />
      </ViewRefsContext.Provider>,
    );

    await vi.waitFor(() => {
      expect(document.querySelector('[data-workspace-view="explorer"]')).toHaveAttribute('aria-hidden', 'false');
    });
  });
});
