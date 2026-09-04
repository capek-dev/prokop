import { createRef } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { WorkspaceWorkbench } from '@/components/app/WorkspaceWorkbench';
import type { FilesPanelHandle } from '@/components/layout/FilesPanel';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useFileEditorStore } from '@/stores/fileEditorStore';

vi.mock('@/components/layout/FilesPanel', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    FilesPanel: forwardRef<FilesPanelHandle>(function MockFilesPanel(_props, ref) {
      useImperativeHandle(ref, () => ({ focus: () => undefined }), []);
      return <div data-testid="explorer-content" />;
    }),
  };
});

vi.mock('@/components/editor/FileEditorSurface', () => ({
  FileEditorSurface: () => <div data-testid="editor-content" />,
}));

vi.mock('@/hooks/queries', () => ({
  useWorktreesQuery: () => ({ data: [], isLoading: false }),
}));

describe('WorkspaceWorkbench', () => {
  beforeEach(() => {
    useChatLayoutStore.setState({
      showFilesPanel: true,
      workbenchSurface: 'explorer',
      filesPanelTab: 'project',
      mobileSurface: 'chat',
    });
    useFileEditorStore.setState({
      docs: {},
      openDocIds: [],
      activeDocId: null,
      anyDirty: false,
    });
  });

  test('keeps workbench content mounted while switching peer tabs', () => {
    useFileEditorStore.getState().openDoc(
      {
        serverId: 'server-1',
        workspaceId: 'workspace-1',
        root: '',
        path: 'src/index.ts',
      },
      'index.ts',
    );

    const filesPanelRef = createRef<FilesPanelHandle>();
    const { getByRole, getByTestId, queryByRole } = render(
      <WorkspaceWorkbench
        sdkClient={null}
        serverId="server-1"
        workspaceId="workspace-1"
        width={540}
        filesPanelRef={filesPanelRef}
        onClose={() => undefined}
      />,
    );

    const explorerContent = getByTestId('explorer-content');
    const editorContent = getByTestId('editor-content');
    expect(getByRole('tablist')).toHaveClass('h-10');
    expect(queryByRole('button', { name: 'Close workbench' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Back to Chat' })).not.toBeInTheDocument();
    expect(explorerContent).toBeInTheDocument();
    expect(editorContent).toBeInTheDocument();
    expect(explorerContent.parentElement).not.toHaveClass('invisible');
    expect(editorContent.parentElement).toHaveClass('invisible');

    fireEvent.click(getByRole('tab', { name: 'Changes' }));

    expect(useChatLayoutStore.getState().workbenchSurface).toBe('changes');
    expect(useChatLayoutStore.getState().filesPanelTab).toBe('changes');
    expect(explorerContent.parentElement).not.toHaveClass('invisible');
    expect(getByTestId('explorer-content')).toBe(explorerContent);

    fireEvent.click(getByRole('tab', { name: 'Editor' }));

    expect(explorerContent.parentElement).toHaveClass('invisible');
    expect(editorContent.parentElement).not.toHaveClass('invisible');

    fireEvent.click(getByRole('tab', { name: 'Explorer' }));

    expect(useChatLayoutStore.getState().workbenchSurface).toBe('explorer');
    expect(useChatLayoutStore.getState().filesPanelTab).toBe('project');
    expect(getByTestId('explorer-content')).toBe(explorerContent);
    expect(getByTestId('editor-content')).toBe(editorContent);
  });

  test('keeps Changes active when no editor documents are open', () => {
    useChatLayoutStore.setState({
      workbenchSurface: 'changes',
      filesPanelTab: 'changes',
    });

    const filesPanelRef = createRef<FilesPanelHandle>();
    const { getByRole, getByTestId, queryByRole } = render(
      <WorkspaceWorkbench
        sdkClient={null}
        serverId="server-1"
        workspaceId="workspace-1"
        width={540}
        filesPanelRef={filesPanelRef}
        onClose={() => undefined}
      />,
    );

    expect(getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true');
    expect(getByTestId('explorer-content').parentElement).not.toHaveClass('invisible');
    expect(queryByRole('tab', { name: 'Editor' })).not.toBeInTheDocument();
  });
});
