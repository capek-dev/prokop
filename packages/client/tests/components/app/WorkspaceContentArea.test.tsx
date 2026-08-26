import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Workspace } from '@prokopai/sdk';
import { WorkspaceContentArea } from '@/components/app/WorkspaceContentArea';
import type { FilesPanelHandle } from '@/components/layout/FilesPanel';
import { ViewRefsContext, type ViewRefs } from '@/contexts/ViewRefsContext';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useFileEditorStore } from '@/stores/fileEditorStore';
import { useServerDataStore } from '@/stores/serverDataStore';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ serverId: 'server-1' }),
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => true,
  useIsCompact: () => true,
}));

vi.mock('@/components/board/SessionBoard', () => ({
  SessionBoard: () => <div data-testid="chat-content" />,
}));

vi.mock('@/components/layout/FilesPanel', async () => {
  const { useChatLayoutStore: layoutStore } = await import('@/stores/chatLayoutStore');
  return {
    FilesPanel: forwardRef<FilesPanelHandle>(function MockFilesPanel(_props, ref) {
      useImperativeHandle(ref, () => ({
        focus: () => layoutStore.getState().setMobileSurface('files'),
      }), []);
      return (
        <div data-testid="files-content">
          <button type="button" onClick={() => layoutStore.getState().setMobileSurface('chat')}>
            Chat
          </button>
        </div>
      );
    }),
  };
});

vi.mock('@/components/editor/FileEditorSurface', () => ({
  FileEditorSurface: () => <div data-testid="editor-content" />,
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

describe('WorkspaceContentArea mobile surfaces', () => {
  beforeEach(() => {
    useChatLayoutStore.setState({
      showFilesPanel: false,
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

  test('uses peer Workbench tabs on phone and keeps their content mounted', () => {
    const { getByRole, getByTestId } = render(
      <ViewRefsContext.Provider value={createViewRefs()}>
        <WorkspaceContentArea sdkClient={null} serverUrl={null} />
      </ViewRefsContext.Provider>,
    );

    const chatSurface = getByTestId('chat-content').closest('[data-mobile-surface="chat"]');
    const workbenchSurface = getByTestId('files-content').closest('[data-mobile-surface="workbench"]');
    expect(chatSurface).not.toHaveClass('invisible');
    expect(workbenchSurface).toHaveClass('invisible');

    act(() => useChatLayoutStore.getState().setMobileSurface('files'));

    expect(chatSurface).toHaveClass('invisible');
    expect(workbenchSurface).not.toHaveClass('invisible');
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
    const editorTab = getByRole('tab', { name: 'Editor' });

    act(() => useChatLayoutStore.getState().setMobileSurface('editor'));

    expect(chatSurface).toHaveClass('invisible');
    expect(workbenchSurface).not.toHaveClass('invisible');
    expect(editorTab).toHaveAttribute('aria-selected', 'true');
    expect(editorContent.parentElement).not.toHaveClass('invisible');

    fireEvent.click(getByRole('tab', { name: 'Changes' }));
    expect(useChatLayoutStore.getState().mobileSurface).toBe('files');
    expect(useChatLayoutStore.getState().filesPanelTab).toBe('changes');
    expect(getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true');
    expect(editorContent.parentElement).toHaveClass('invisible');

    fireEvent.click(getByRole('tab', { name: 'Explorer' }));
    expect(useChatLayoutStore.getState().filesPanelTab).toBe('project');
    expect(getByRole('tab', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(getByRole('button', { name: 'Back to Chat' }));
    expect(chatSurface).not.toHaveClass('invisible');
    expect(workbenchSurface).toHaveClass('invisible');
    expect(getByTestId('files-content')).toBeInTheDocument();
    expect(getByTestId('editor-content')).toBe(editorContent);
  });

  test('keeps Chat mounted while Sessions opens and returns to Chat', () => {
    useChatLayoutStore.setState({ mobileSurface: 'sessions' });

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

    const chatSurface = getByTestId('chat-content').closest('[data-mobile-surface="chat"]');
    const sessionsSurface = getByTestId('session-row').closest('[data-mobile-surface="sessions"]');
    expect(chatSurface).toHaveClass('invisible');
    expect(chatSurface).toHaveAttribute('inert');
    expect(sessionsSurface).not.toHaveClass('invisible');
    expect(sessionsSurface).not.toHaveAttribute('inert');
    expect(container.querySelectorAll('[data-mobile-surface="sessions"]')).toHaveLength(1);
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Back to Chat' }));

    expect(useChatLayoutStore.getState().mobileSurface).toBe('chat');
    expect(chatSurface).not.toHaveClass('invisible');
    expect(sessionsSurface).toHaveClass('invisible');
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
      expect(useChatLayoutStore.getState().mobileSurface).toBe('files');
    });
  });
});
