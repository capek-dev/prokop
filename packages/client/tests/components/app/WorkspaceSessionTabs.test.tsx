import { createRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Agent, Message, Session, Workspace } from '@prokopai/sdk';
import type { ChatView } from '@/components/chat/ChatView';
import { WorkspaceContentArea } from '@/components/app/WorkspaceContentArea';
import { ViewRefsContext, type ViewRefs } from '@/contexts/ViewRefsContext';
import { SessionPaneRegistryContext, type SessionPaneRegistry } from '@/contexts/SessionPaneRegistryContext';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useFileEditorStore } from '@/stores/fileEditorStore';
import { useAskStore, type PendingAskRequest } from '@/stores/askStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useDockStore } from '@/stores/dockStore';
import { createDefaultViewLayout, sessionViewId, useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useForeignSessionsStore } from '@/stores/foreignSessionsStore';
import { ServerContext } from '@/contexts/ServerContext';

const mocks = vi.hoisted(() => ({ mobile: false, navigate: vi.fn(), send: vi.fn(), interrupt: vi.fn(), ask: vi.fn(), mount: vi.fn(), unmount: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ serverId: 'server' }),
  useNavigate: () => mocks.navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { pathname: '/server/server/workspace' } }),
}));
vi.mock('@/components/app/ForeignSessionView', () => ({ ForeignSessionView: ({ serverId, sessionId }: { serverId: string; sessionId: string }) => <div>Foreign {sessionId} on {serverId}</div> }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mocks.mobile, useIsCompact: () => false }));
vi.mock('@/components/layout/FilesPanel', () => ({ FilesPanel: () => <div>Repository tool</div> }));
vi.mock('@/components/app/WorkspaceUsageView', () => ({ WorkspaceUsageView: () => <div>Usage</div> }));
vi.mock('@/components/worktrees/WorktreesPanel', () => ({ WorktreesPanel: () => <div>Worktrees</div> }));
vi.mock('@/components/app/WorkspaceHeader', () => ({ WorkspaceHeader: ({ sessionId }: { sessionId: string }) => <div>Header {sessionId}</div> }));
vi.mock('@/contexts/SessionCommandsContext', () => ({ useSessionCommands: () => ({ sendChatMessageForSession: mocks.send, handleInterruptSessionById: mocks.interrupt, handleAskResponse: mocks.ask }) }));
vi.mock('@/hooks/queries', () => ({
  usePinnedMessagesQuery: () => ({ data: [] }),
  usePinMessageMutation: () => ({}), useUnpinMessageMutation: () => ({}),
}));
vi.mock('@/components/chat/ChatView', () => ({
  ChatView: function Chat(props: ComponentProps<typeof ChatView>) {
    const [draft, setDraft] = useState('');
    const input = useRef<HTMLInputElement>(null);
    useImperativeHandle(props.inputRef, () => ({ focus: () => input.current?.focus(), restoreText: setDraft }), []);
    useEffect(() => { mocks.mount(props.session.id); return () => mocks.unmount(props.session.id); }, [props.session.id]);
    return <div data-testid={`chat-${props.session.id}`}>
      <input ref={input} aria-label={`Draft ${props.session.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button onClick={() => props.onSendMessage(draft)}>Send</button>
      <button onClick={props.onInterrupt}>Stop</button>
      <span>{props.messagesWithParts.length} messages</span>
      {props.pendingAskRequests.map((ask) => <button key={ask.toolCallId} onClick={() => props.onAskResponse(ask.toolCallId, { type: 'confirm', confirmed: true }, ask.requestId)}>Answer {ask.toolCallId}</button>)}
    </div>;
  },
}));

function host(id: string): HTMLElement { return document.getElementById(`workspace-view-${sessionViewId('server', id)}`)!; }

function Harness() {
  const [refs] = useState<ViewRefs>(() => ({ sidebarRef: createRef(), chatInputRef: createRef(), terminalPanelRef: createRef(), filesPanelRef: createRef(), scrollToBottomRef: createRef(), autoFollowToggleRef: createRef() }));
  const [registry] = useState<SessionPaneRegistry>(() => {
    const panes: SessionPaneRegistry['panes'] = new Map();
    return { panes, register: (id, handle) => { panes.set(id, handle); }, unregister: (id) => { panes.delete(id); }, getHandle: (id) => panes.get(id) };
  });
  return <ViewRefsContext value={refs}><SessionPaneRegistryContext value={registry}><WorkspaceContentArea sdkClient={null} serverUrl={null} /></SessionPaneRegistryContext></ViewRefsContext>;
}

describe('individual session tabs', () => {
  beforeEach(() => {
    mocks.mobile = false;
    vi.clearAllMocks();
    useSessionStore.setState(useSessionStore.getInitialState());
    useSessionBoardStore.setState({ openSessionIds: [], focusedSessionId: null });
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
    useDockStore.setState(useDockStore.getInitialState());
    useChatLayoutStore.setState(useChatLayoutStore.getInitialState());
    useFileEditorStore.setState(useFileEditorStore.getInitialState());
    useAskStore.setState({ pendingRequests: [] });
    useConnectionStore.setState({ connected: false, streamingSessionIds: new Set() });
    useServerDataStore.setState({ serverId: 'server', agents: [], activeWorkspace: { id: 'workspace' } as Workspace, workspaces: [{ id: 'workspace', name: 'Project' } as Workspace] });
    const sessions = Array.from({ length: 12 }, (_, index) => ({ id: `s${index}`, workspaceId: 'workspace', title: `Session ${index}` }) as Session);
    useSessionStore.setState({ sessions });
    useSessionBoardStore.getState().hydrateFromRoute('s0', sessions.map((session) => session.id));
  });
  afterEach(() => { cleanup(); localStorage.clear(); });

  test('selecting a new or retained session focuses its input after the portal is visible', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: 'Project / Session 1' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Draft s1' })).toHaveFocus());
    fireEvent.click(screen.getByRole('tab', { name: 'Project / Session 0' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Draft s0' })).toHaveFocus());
  });

  test('titles follow workspace and agent names, with readable fallbacks while metadata loads', () => {
    useServerDataStore.setState({ workspaces: [] });
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'Session 0' })).toHaveAttribute('title', 'Session 0');
    act(() => useServerDataStore.setState({
      workspaces: [{ id: 'workspace', name: 'Project' } as Workspace],
    }));
    expect(screen.getByRole('tab', { name: 'Project / Session 0' })).toHaveAttribute('title', 'Project / Session 0');
    act(() => useServerDataStore.setState({
      workspaces: [{ id: 'workspace', name: 'Agent home', settings: { isAgentHome: true, agentId: 'agent' } } as Workspace],
      agents: [{ id: 'agent', name: 'Coder' } as Agent],
    }));
    expect(screen.getByRole('tab', { name: 'Coder / Session 0' })).toBeInTheDocument();
    act(() => useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => session.id === 's0' ? { ...session, title: '' } : session),
    })));
    expect(screen.getByRole('tab', { name: 'Coder / Untitled session' })).toBeInTheDocument();
  });

  test('child activity and requests reach parent tabs, with attention taking priority until resolved', () => {
    const child = {
      id: 'child', parentId: 's0', workspaceId: 'workspace', subagentStatus: 'running',
      harnessState: { capabilities: { subagentActivityPropagates: true } },
    } as Session;
    useSessionStore.setState((state) => ({ sessions: [...state.sessions, child] }));
    render(<Harness />);
    const tab = screen.getByRole('tab', { name: 'Project / Session 0' });
    expect(within(tab).getByRole('img', { name: 'Running' })).toBeInTheDocument();
    act(() => useAskStore.setState({ pendingRequests: [{
      sessionId: 'child', originSessionId: 's1', toolCallId: 'ask', toolName: 'confirm',
      ask: { type: 'confirm', target: 'human', question: 'Continue?' },
    }] }));
    expect(within(tab).getByRole('img', { name: 'Needs input' })).toBeInTheDocument();
    expect(within(tab).queryByRole('img', { name: 'Running' })).toBeNull();
    expect(tab).toHaveAttribute('title', 'Project / Session 0 (Needs input)');
    expect(within(screen.getByRole('tab', { name: 'Project / Session 1' })).getByRole('img', { name: 'Needs input' })).toBeInTheDocument();
    act(() => useAskStore.setState({ pendingRequests: [] }));
    expect(within(tab).getByRole('img', { name: 'Running' })).toBeInTheDocument();
    act(() => useSessionStore.setState((state) => ({ sessions: state.sessions.filter((session) => session.id !== 'child') })));
    expect(within(tab).queryByRole('img')).toBeNull();
  });

  test('running metadata and attention remain visible in mobile tabs and tab search', () => {
    mocks.mobile = true;
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => session.id === 's0' ? { ...session, runningAt: '2026-10-05T08:00:00Z' } : session),
    }));
    useAskStore.setState({ pendingRequests: [{ sessionId: 's1', toolCallId: 'ask' } as PendingAskRequest] });
    render(<Harness />);
    expect(within(screen.getByRole('tab', { name: 'Project / Session 0' })).getByRole('img', { name: 'Running' })).toBeInTheDocument();
    expect(within(screen.getByRole('tab', { name: 'Project / Session 1' })).getByRole('img', { name: 'Needs input' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Find open tab' }));
    expect(within(screen.getByRole('option', { name: /Project \/ Session 0/ })).getByRole('img', { name: 'Running' })).toBeInTheDocument();
    expect(within(screen.getByRole('option', { name: /Project \/ Session 1$/ })).getByRole('img', { name: 'Needs input' })).toBeInTheDocument();
  });

  test('twelve tabs defer inactive panes, keep independent drafts and scroll, and move without remounting', () => {
    const { rerender } = render(<Harness />);
    expect(screen.queryByRole('tab', { name: 'Conversations' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Board layout' })).toBeNull();
    expect(mocks.mount).toHaveBeenCalledTimes(1);
    const first = screen.getByRole('textbox', { name: 'Draft s0' });
    fireEvent.change(first, { target: { value: 'first draft' } });
    screen.getByTestId('chat-s0').scrollTop = 84;
    fireEvent.click(screen.getByRole('tab', { name: 'Project / Session 1' }));
    const second = screen.getByRole('textbox', { name: 'Draft s1' });
    fireEvent.change(second, { target: { value: 'second draft' } });
    act(() => useDockStore.getState().setDockOpen('right', true));
    const dataTransfer = new DataTransfer();
    fireEvent.dragStart(screen.getByRole('tab', { name: 'Project / Session 0' }), { dataTransfer });
    fireEvent.drop(screen.getByRole('tablist', { name: 'Right dock views' }), { dataTransfer });
    expect(host('s0')).toHaveAttribute('aria-hidden', 'false');
    expect(host('s1')).toHaveAttribute('aria-hidden', 'false');
    fireEvent.pointerDown(first);
    expect(useSessionBoardStore.getState().focusedSessionId).toBe('s0');
    expect(mocks.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ params: { serverId: 'server', sessionId: 's0' }, search: { open: Array.from({ length: 12 }, (_, i) => `s${i}`).join(',') } }));
    fireEvent.click(within(host('s0')).getByRole('button', { name: 'Send' }));
    expect(mocks.send).toHaveBeenCalledWith('s0', 'first draft', undefined, undefined, undefined);
    act(() => useWorkspaceViewStore.getState().hideView(sessionViewId('server', 's0')));
    act(() => useSessionBoardStore.getState().openInFocusedPane('s0'));
    expect(screen.getByRole('textbox', { name: 'Draft s0' })).toBe(first);
    mocks.mobile = true;
    rerender(<Harness />);
    expect(screen.getByRole('textbox', { name: 'Draft s0' })).toBe(first);
    fireEvent.click(screen.getByRole('tab', { name: 'Project / Session 1' }));
    expect(screen.getByRole('textbox', { name: 'Draft s1' })).toBe(second);
    mocks.mobile = false;
    rerender(<Harness />);
    expect(first).toHaveValue('first draft');
    expect(second).toHaveValue('second draft');
    expect(screen.getByTestId('chat-s0').scrollTop).toBe(84);
    expect(mocks.mount).toHaveBeenCalledTimes(2);
    expect(mocks.unmount).not.toHaveBeenCalled();
  });

  test('nested center splits keep three independent sessions and collapse after close', () => {
    render(<Harness />);
    const first = screen.getByRole('textbox', { name: 'Draft s0' });
    fireEvent.change(first, { target: { value: 'retained split draft' } });
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Project / Session 0' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Split right' }));
    expect(host('s0')).toHaveAttribute('aria-hidden', 'false');
    expect(host('s1')).toHaveAttribute('aria-hidden', 'false');
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Project / Session 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Split down' }));
    expect(host('s0')).toHaveAttribute('aria-hidden', 'false');
    expect(host('s1')).toHaveAttribute('aria-hidden', 'false');
    expect(host('s2')).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getAllByRole('separator', { name: 'Resize center split' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Close Project / Session 1' }));
    expect(screen.getAllByRole('separator', { name: 'Resize center split' })).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Draft s0' })).toBe(first);
    expect(first).toHaveValue('retained split draft');
    expect(mocks.interrupt).not.toHaveBeenCalled();
  });

  test('background asks and streaming stay keyed to their session; closing tabs never interrupts', () => {
    render(<Harness />);
    act(() => {
      useConnectionStore.setState({ streamingSessionIds: new Set(['s0']) });
      useAskStore.setState({ pendingRequests: [{ toolCallId: 'ask-1', sessionId: 's1', requestId: 'request-1' } as PendingAskRequest] });
      useSessionStore.setState({ messagesBySession: { s0: [{ id: 'message', sessionId: 's0', role: 'assistant' } as Message] } });
    });
    expect(within(screen.getByRole('tab', { name: 'Project / Session 0' })).getByRole('img', { name: 'Running' })).toBeInTheDocument();
    expect(within(screen.getByRole('tab', { name: 'Project / Session 1' })).getByRole('img', { name: 'Needs input' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Project / Session 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Answer ask-1' }));
    expect(mocks.ask).toHaveBeenCalledWith('ask-1', { type: 'confirm', confirmed: true }, 'request-1');
    fireEvent.click(screen.getByRole('button', { name: 'Close Project / Session 0' }));
    expect(mocks.interrupt).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().streamingSessionIds.has('s0')).toBe(true);
    expect(useSessionStore.getState().messagesBySession.s0).toHaveLength(1);
    expect(useSessionStore.getState().sessions.find((session) => session.id === 's0')).toBeDefined();
    expect(host('s0')).toBeNull();
    expect(mocks.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ params: { serverId: 'server', sessionId: 's1' } }));
  });

  test('close-all removes session tabs and clears the route while keeping repository views', () => {
    render(<Harness />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Project / Session 0' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close all session tabs' }));
    expect(useSessionBoardStore.getState().openSessionIds).toEqual([]);
    expect(mocks.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ to: '/server/$serverId/workspace', search: {} }));
    expect(screen.queryByRole('tab', { name: 'Project / Session 0' })).toBeNull();
    expect(screen.getByText('Open a session or add a view.')).toBeInTheDocument();
    expect(document.querySelector('[data-workspace-view="explorer"]')).toBeInTheDocument();
    expect(mocks.interrupt).not.toHaveBeenCalled();
  });
});

describe('tabs from another machine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ ...useSessionStore.getInitialState(), sessions: [{ id: 'local', workspaceId: 'workspace', title: 'Local' } as Session] });
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
    useAskStore.setState({ pendingRequests: [] });
    useConnectionStore.setState({ connected: false, streamingSessionIds: new Set(['remote']) });
    useServerDataStore.setState({ serverId: 'server', agents: [], activeWorkspace: { id: 'workspace' } as Workspace, workspaces: [{ id: 'workspace', name: 'Project' } as Workspace] });
    useForeignSessionsStore.setState({ byId: {} });
    useForeignSessionsStore.getState().add('laptop', { id: 'remote', workspaceId: 'w-remote', title: 'Deploy' } as Session);
    useSessionBoardStore.setState({ openSessionIds: [], focusedSessionId: null });
    useSessionBoardStore.getState().hydrateFromRoute('remote', ['local', 'remote']);
  });
  afterEach(() => { cleanup(); localStorage.clear(); });

  test('are labelled with the machine, show live status, and render through the machine\'s own view', () => {
    const servers = [{ id: 'laptop', name: 'Laptop', url: 'laptop', createdAt: '' }];
    render(<ServerContext value={{ servers } as never}><Harness /></ServerContext>);

    const tab = screen.getByRole('tab', { name: 'Laptop / Deploy' });
    expect(within(tab).getByRole('img', { name: 'Running' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Project / Local' })).toBeInTheDocument();
    expect(document.getElementById(`workspace-view-${sessionViewId('laptop', 'remote')}`)).not.toBeNull();
    expect(screen.getByText('Foreign remote on laptop')).toBeInTheDocument();
  });
});
