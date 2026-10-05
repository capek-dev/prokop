import { createRef, useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@prokopai/sdk';
import type { ProkopaiClient, Session, Workspace } from '@prokopai/sdk';
import { WorkspaceContentArea } from '@/components/app/WorkspaceContentArea';
import { ViewRefsContext, type ViewRefs } from '@/contexts/ViewRefsContext';
import { useFileEditorStore } from '@/stores/fileEditorStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useDockStore } from '@/stores/dockStore';
import { createDefaultViewLayout, fileViewId, findViewRegion, useWorkspaceViewStore } from '@/stores/workspaceViewStore';

const mocks = vi.hoisted(() => ({ mobile: false, compact: false, mount: vi.fn(), unmount: vi.fn(), gitDiff: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ serverId: 'server-1' }), useNavigate: () => vi.fn(), useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { pathname: '/server/server-1/workspace/session/session-1' } }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mocks.mobile, useIsCompact: () => mocks.compact }));
vi.mock('@/components/board/SessionPane', () => ({ SessionPane: () => <div>Conversation content</div> }));
vi.mock('@/components/worktrees/WorktreesPanel', () => ({ WorktreesPanel: () => <div>Worktrees content</div> }));
vi.mock('@/components/layout/FilesPanel', () => ({ FilesPanel: () => <div>Explorer content</div> }));
vi.mock('@/hooks/queries', () => ({
  useWorktreesQuery: () => ({ data: [], isLoading: false }),
  useEditorGitDiffQuery: (...args: unknown[]) => { mocks.gitDiff(...args); return { data: undefined, isFetching: false }; },
}));
vi.mock('@/components/editor/PierreCodeEditor', () => ({
  PierreCodeEditor: function Editor({ docId, fileName, value, onChange }: { docId: string; fileName: string; value: string; onChange: (value: string) => void }) {
    const [undo, setUndo] = useState<string[]>([]);
    useEffect(() => { mocks.mount(docId); return () => mocks.unmount(docId); }, [docId]);
    return <div>
      <textarea aria-label={`Edit ${fileName}`} value={value} onChange={(event) => { setUndo([...undo, value]); onChange(event.target.value); }} />
      <button type="button" onClick={() => { const previous = undo.at(-1); if (previous !== undefined) { setUndo(undo.slice(0, -1)); onChange(previous); } }}>Undo</button>
    </div>;
  },
}));

function openFile(name: string, root = '', workspaceId = 'workspace-1'): string {
  const identity = { serverId: 'server-1', workspaceId, root, path: `src/${name}` };
  const id = useFileEditorStore.getState().openDoc(identity, name);
  useFileEditorStore.getState().hydrateSuccess(id, {
    path: identity.path, name, size: 1, content: name, revision: `rev-${name}`, readOnly: false, encoding: 'utf-8',
  });
  return id;
}

function host(docId: string): HTMLElement {
  return document.getElementById(`workspace-view-${fileViewId(docId)}`)!;
}

function Harness({ client = null }: { client?: ProkopaiClient | null }) {
  const [refs] = useState<ViewRefs>(() => ({
    sidebarRef: createRef(), chatInputRef: createRef(), terminalPanelRef: createRef(),
    filesPanelRef: createRef(), scrollToBottomRef: createRef(), autoFollowToggleRef: createRef(),
  }));
  return <ViewRefsContext value={refs}><WorkspaceContentArea sdkClient={client} serverUrl={null} /></ViewRefsContext>;
}

describe('individual workspace file tabs', () => {
  beforeEach(() => {
    mocks.mobile = false;
    mocks.compact = false;
    vi.clearAllMocks();
    useSessionBoardStore.setState({ openSessionIds: ['session-1'], focusedSessionId: 'session-1' });
    useSessionStore.setState({ sessions: [{ id: 'session-1', workspaceId: 'workspace-1', title: 'Session one' } as Session] });
    useServerDataStore.setState({ serverId: 'server-1', workspaces: [], agents: [] });
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout(), mobileTerminalOpen: false });
    useDockStore.setState(useDockStore.getInitialState());
    useFileEditorStore.setState({ docs: {}, openDocIds: [], activeDocId: null, anyDirty: false });
    useServerDataStore.setState({ activeWorkspace: { id: 'workspace-1' } as Workspace });
    useChatLayoutStore.setState({ mobileSurface: 'chat', workbenchSurface: 'explorer', filesPanelTab: 'project' });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout(), mobileTerminalOpen: false });
    useFileEditorStore.setState({ docs: {}, openDocIds: [], activeDocId: null, anyDirty: false });
    localStorage.clear();
  });

  test('keeps two editors independently selected across docks, reopening and mobile transitions', () => {
    const first = openFile('first.ts');
    const second = openFile('second.ts');
    const { rerender } = render(<Harness />);
    const firstInput = within(host(first)).getByRole('textbox', { hidden: true });
    const secondInput = within(host(second)).getByRole('textbox');
    act(() => useWorkspaceViewStore.getState().moveView(fileViewId(first), 'right'));
    expect(host(first)).toHaveAttribute('aria-hidden', 'false');
    expect(host(second)).toHaveAttribute('aria-hidden', 'false');
    fireEvent.change(firstInput, { target: { value: 'first draft' } });
    fireEvent.change(secondInput, { target: { value: 'second draft' } });
    firstInput.focus();
    expect(useFileEditorStore.getState().activeDocId).toBe(first);
    expect(host(second)).toHaveAttribute('aria-hidden', 'false');
    fireEvent.click(screen.getByRole('tab', { name: 'Session one' }));
    expect(host(second)).toHaveAttribute('aria-hidden', 'true');
    expect(host(first)).toHaveAttribute('aria-hidden', 'false');
    act(() => useFileEditorStore.getState().openDoc(useFileEditorStore.getState().docs[first].identity, 'first.ts'));
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, fileViewId(first))).toBe('right');
    expect(screen.getAllByRole('tab', { name: 'first.ts' })).toHaveLength(1);

    mocks.mobile = true;
    act(() => useChatLayoutStore.getState().setMobileSurface('editor'));
    rerender(<Harness />);
    expect(within(host(first)).getByRole('textbox')).toBe(firstInput);
    fireEvent.click(screen.getByRole('tab', { name: 'second.ts' }));
    expect(within(host(second)).getByRole('textbox')).toBe(secondInput);
    expect(host(first)).toHaveAttribute('aria-hidden', 'true');
    mocks.mobile = false;
    rerender(<Harness />);
    fireEvent.click(within(host(first)).getByRole('button', { name: 'Undo' }));
    expect(firstInput).toHaveValue('first.ts');
    expect(secondInput).toHaveValue('second draft');
    expect(mocks.mount).toHaveBeenCalledTimes(2);
    expect(mocks.unmount).not.toHaveBeenCalled();
  });

  test('context menus move the clicked inactive tab through the destination submenu', () => {
    const first = openFile('first.ts');
    const second = openFile('second.ts');
    render(<Harness />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'first.ts' }));
    expect(screen.getByRole('tab', { name: 'second.ts', hidden: true })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('menuitem', { name: 'Right dock' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Move to' }), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Right dock' }));
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, fileViewId(first))).toBe('right');
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, fileViewId(second))).toBe('center');
    expect(host(first)).toHaveAttribute('aria-hidden', 'false');
    expect(host(second)).toHaveAttribute('aria-hidden', 'false');
  });

  test('context close on an inactive dirty file preserves its close guard', () => {
    const first = openFile('first.ts');
    const second = openFile('second.ts');
    render(<Harness />);
    act(() => useFileEditorStore.getState().updateContent(first, 'unsaved'));
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'first.ts' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tab' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('first.ts has unsaved changes');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useFileEditorStore.getState().docs[first].content).toBe('unsaved');
    expect(useFileEditorStore.getState().docs[second]).toBeDefined();
  });

  test('split editors retain undo and dirty guards until the final tab is discarded', () => {
    const first = openFile('first.ts');
    const second = openFile('second.ts');
    render(<Harness />);
    const input = within(host(second)).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'keep undo' } });
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'second.ts' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Split right' }));
    expect(host(first)).toHaveAttribute('aria-hidden', 'false');
    expect(host(second)).toHaveAttribute('aria-hidden', 'false');
    expect(within(host(second)).getByRole('textbox')).toBe(input);
    fireEvent.click(within(host(second)).getByRole('button', { name: 'Undo' }));
    expect(input).toHaveValue('second.ts');
    fireEvent.change(input, { target: { value: 'unsaved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close second.ts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('separator', { name: 'Resize center split' })).toBeInTheDocument();
    expect(input).toHaveValue('unsaved');
    fireEvent.click(screen.getByRole('button', { name: 'Close second.ts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('separator', { name: 'Resize center split' })).toBeNull();
    expect(host(first)).toHaveAttribute('aria-hidden', 'false');
  });

  test('shared close controls preserve the dirty guard and only discard the chosen file', () => {
    const first = openFile('first.ts');
    const second = openFile('second.ts');
    render(<Harness />);
    act(() => useFileEditorStore.getState().updateContent(first, 'unsaved'));
    fireEvent.click(screen.getByRole('button', { name: 'Close first.ts' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('first.ts has unsaved changes');
    expect(host(first)).toHaveAttribute('aria-hidden', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useFileEditorStore.getState().docs[first].content).toBe('unsaved');
    fireEvent.click(screen.getByRole('button', { name: 'Close first.ts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(useFileEditorStore.getState().docs[first]).toBeUndefined();
    expect(useFileEditorStore.getState().docs[second]).toBeDefined();
    expect(host(second)).toHaveAttribute('aria-hidden', 'false');
    expect(useWorkspaceViewStore.getState().layout.groups.center.viewIds).not.toContain(fileViewId(first));
  });

  test('saving uses the moved file identity and preserves it on failure', async () => {
    const id = openFile('index.ts', '/extra/root');
    const save = vi.fn().mockRejectedValue(new Error('disk full'));
    const client = { http: { files: { save } } } as unknown as ProkopaiClient;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Harness client={client} />);
    act(() => {
      useWorkspaceViewStore.getState().moveView(fileViewId(id), 'left');
      useFileEditorStore.getState().updateContent(id, 'draft');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close index.ts' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('workspace-1', expect.objectContaining({ path: 'src/index.ts', root: '/extra/root', content: 'draft' })));
    await waitFor(() => expect(useFileEditorStore.getState().docs[id].status).toBe('loaded'));
    expect(host(id)).toBeInTheDocument();
    expect(useFileEditorStore.getState().anyDirty).toBe(true);
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, fileViewId(id))).toBe('left');
  });

  test('save-and-close keeps a conflicted file open at its moved location', async () => {
    const id = openFile('conflict.ts');
    const save = vi.fn().mockRejectedValue(new ApiError('Changed on disk', 409, 'FILE_REVISION_CONFLICT', {
      details: { path: 'src/conflict.ts', expectedRevision: 'rev-conflict.ts', actualRevision: 'r2', currentContent: 'external edit' },
    }));
    const client = { http: { files: { save } } } as unknown as ProkopaiClient;
    render(<Harness client={client} />);
    act(() => {
      useWorkspaceViewStore.getState().moveView(fileViewId(id), 'bottom');
      useFileEditorStore.getState().updateContent(id, 'local draft');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close conflict.ts' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await screen.findByText('This file changed on disk. Your edits conflict with the saved version.');
    expect(useFileEditorStore.getState().docs[id].content).toBe('local draft');
    expect(useFileEditorStore.getState().docs[id].conflict?.currentContent).toBe('external edit');
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, fileViewId(id))).toBe('bottom');
  });

  test('save-and-close succeeds for the chosen file without closing another editor', async () => {
    const first = openFile('first.ts');
    const second = openFile('second.ts');
    const save = vi.fn().mockResolvedValue({ revision: 'saved' });
    const client = { http: { files: { save } } } as unknown as ProkopaiClient;
    render(<Harness client={client} />);
    act(() => useFileEditorStore.getState().updateContent(first, 'saved draft'));
    fireEvent.click(screen.getByRole('button', { name: 'Close first.ts' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(useFileEditorStore.getState().docs[first]).toBeUndefined());
    expect(host(second)).toBeInTheDocument();
    expect(useFileEditorStore.getState().anyDirty).toBe(false);
  });

  test('panel menu omits search and tab selection loads only selected documents', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 12; index++) {
      ids.push(useFileEditorStore.getState().openDoc({
        serverId: 'server-1', workspaceId: 'workspace-1', root: '/checkout',
        path: `src/module${index}/index.ts`,
      }, 'index.ts'));
    }
    const readEditable = vi.fn(async (_workspaceId: string, path: string) => ({
      path, name: 'index.ts', size: 1, content: path, revision: 'r1', readOnly: false, encoding: 'utf-8',
    }));
    const client = { http: { files: { readEditable } } } as unknown as ProkopaiClient;
    render(<Harness client={client} />);
    await waitFor(() => expect(useFileEditorStore.getState().docs[ids[11]].status).toBe('loaded'));
    expect(readEditable).toHaveBeenCalledTimes(1);
    const center = document.querySelector<HTMLElement>('[data-view-group="center"]')!;
    expect(center.querySelectorAll('[data-workspace-panel-menu]')).toHaveLength(1);
    expect(within(center).queryByRole('button', { name: 'Find open tab' })).toBeNull();
    fireEvent.pointerDown(within(center).getByRole('button', { name: /panel options$/ }), { button: 0, ctrlKey: false });
    expect(screen.queryByRole('menuitem', { name: 'Find open tab' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Move to' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^(Split|Close|Hide)/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Reset arrangement' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(within(center).getByRole('tab', { name: /module5/ }));
    await waitFor(() => expect(useFileEditorStore.getState().docs[ids[5]].status).toBe('loaded'));
    expect(readEditable).toHaveBeenCalledTimes(2);
    expect(readEditable).toHaveBeenLastCalledWith('workspace-1', 'src/module5/index.ts', expect.objectContaining({ root: '/checkout' }));
    expect(host(ids[5])).toHaveAttribute('aria-hidden', 'false');
    expect(host(ids[11])).toHaveAttribute('aria-hidden', 'true');
    expect(mocks.mount).toHaveBeenCalledTimes(2);
  });

  test('keyboard tab navigation and Delete close the selected clean document', () => {
    const first = openFile('first.ts');
    const second = openFile('second.ts');
    render(<Harness />);
    const last = screen.getByRole('tab', { name: 'second.ts' });
    last.focus();
    fireEvent.keyDown(last, { key: 'ArrowLeft' });
    const previous = screen.getByRole('tab', { name: 'first.ts' });
    expect(previous).toHaveFocus();
    expect(host(first)).toHaveAttribute('aria-hidden', 'false');
    expect(host(second)).toHaveAttribute('aria-hidden', 'true');
    fireEvent.keyDown(previous, { key: 'Delete' });
    expect(host(first)).toBeNull();
    expect(host(second)).toHaveAttribute('aria-hidden', 'false');
  });

  test('clean close is immediate, and files from other projects remain available', () => {
    const first = openFile('first.ts');
    const second = openFile('second.ts');
    const other = openFile('other.ts', '', 'workspace-2');
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'other.ts' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close first.ts' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(host(first)).toBeNull();
    expect(useFileEditorStore.getState().docs[second]).toBeDefined();
    expect(useFileEditorStore.getState().docs[other]).toBeDefined();
  });

  test('project switches retain mixed tabs, undo, placement, and original save targets', async () => {
    const first = openFile('first.ts', '/checkout-a');
    const second = openFile('second.ts', '/checkout-b', 'workspace-2');
    const save = vi.fn().mockResolvedValue({ revision: 'saved' });
    const client = { http: { files: { save } } } as unknown as ProkopaiClient;
    render(<Harness client={client} />);
    act(() => useWorkspaceViewStore.getState().moveView(fileViewId(first), 'right'));
    const firstInput = within(host(first)).getByRole('textbox');
    const secondInput = within(host(second)).getByRole('textbox');
    fireEvent.change(firstInput, { target: { value: 'first draft' } });
    fireEvent.change(secondInput, { target: { value: 'second draft' } });
    const layout = useWorkspaceViewStore.getState().layout;
    act(() => useServerDataStore.setState({ activeWorkspace: { id: 'workspace-3' } as Workspace }));
    expect(within(host(first)).getByRole('textbox')).toBe(firstInput);
    expect(within(host(second)).getByRole('textbox')).toBe(secondInput);
    expect(useWorkspaceViewStore.getState().layout).toBe(layout);
    firstInput.focus();
    expect(useServerDataStore.getState().activeWorkspace?.id).toBe('workspace-3');
    fireEvent.click(within(host(first)).getByRole('button', { name: 'Undo' }));
    expect(firstInput).toHaveValue('first.ts');
    expect(secondInput).toHaveValue('second draft');
    fireEvent.click(within(host(second)).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('workspace-2', expect.objectContaining({ root: '/checkout-b', path: 'src/second.ts', content: 'second draft' })));
    expect(mocks.unmount).not.toHaveBeenCalled();
    act(() => useServerDataStore.setState({ activeWorkspace: null }));
    expect(within(host(second)).getByRole('textbox')).toBe(secondInput);
    expect(screen.getByRole('tab', { name: 'Session one' })).toBeInTheDocument();
  });

  test('duplicate names expose project and checkout context while other servers stay hidden', () => {
    useServerDataStore.setState({ workspaces: [
      { id: 'workspace-1', name: 'Project A' } as Workspace,
      { id: 'workspace-2', name: 'Project B' } as Workspace,
    ] });
    const first = openFile('index.ts', '/checkout-a');
    const second = openFile('index.ts', '/checkout-b', 'workspace-2');
    useFileEditorStore.getState().openDoc({ serverId: 'other-server', workspaceId: 'workspace-1', root: '', path: 'secret.ts' }, 'secret.ts');
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'index.ts · Project A · /checkout-a · src/index.ts' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'index.ts · Project B · /checkout-b · src/index.ts' })).toBeInTheDocument();
    expect(host(first)).toHaveTextContent('Project A · /checkout-a · src/index.ts');
    expect(host(second)).toHaveTextContent('Project B · /checkout-b · src/index.ts');
    expect(screen.queryByRole('tab', { name: 'secret.ts' })).toBeNull();
  });
});
