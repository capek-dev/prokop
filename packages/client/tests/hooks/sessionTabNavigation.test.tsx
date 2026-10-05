import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient, Session, Workspace } from '@prokopai/sdk';
import { useBoardRouteSync } from '@/hooks/useBoardRouteSync';
import { useOverviewRouteSessionLoader } from '@/hooks/useOverviewRouteSessionLoader';
import { useSessionCommands } from '@/hooks/useSessionCommands';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { createDefaultViewLayout, findViewRegion, sessionViewId, useWorkspaceViewStore } from '@/stores/workspaceViewStore';

const route = vi.hoisted(() => ({ location: { pathname: '/server/server/workspace/session/s7', search: { open: '' } } }));
vi.mock('@tanstack/react-router', () => ({ useRouterState: ({ select }: { select: (state: typeof route) => unknown }) => select(route) }));
const workspace = { id: 'workspace', name: 'Project', path: '/project' } as Workspace;
const sessions = Array.from({ length: 12 }, (_, index) => ({ id: `s${index}`, workspaceId: 'workspace', title: `Session ${index}` }) as Session);

beforeEach(() => {
  useServerDataStore.setState({ serverId: 'server', activeWorkspace: workspace, workspaces: [workspace] });
  useSessionStore.setState(useSessionStore.getInitialState());
  useSessionBoardStore.setState({ openSessionIds: [], focusedSessionId: null });
  useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
  route.location.pathname = '/server/server/workspace/session/s7';
  route.location.search.open = sessions.map((session) => session.id).join(',');
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe('session tab routing', () => {
  test('old multi-session URLs restore more than six tabs, filtering invalid workspace IDs', () => {
    useSessionStore.setState({ sessions: [...sessions, { id: 'other', workspaceId: 'private' } as Session] });
    route.location.search.open += ',s7,other,missing';
    const { rerender } = renderHook(() => useBoardRouteSync({ scope: { kind: 'workspace', workspaceId: 'workspace' } }));
    expect(useSessionBoardStore.getState()).toMatchObject({ openSessionIds: sessions.map((session) => session.id), focusedSessionId: 's7' });
    route.location.pathname = '/server/server/workspace/session/s2';
    rerender();
    expect(useSessionBoardStore.getState().focusedSessionId).toBe('s2');
    route.location.pathname = '/server/server/workspace';
    route.location.search.open = '';
    rerender();
    expect(useSessionBoardStore.getState().openSessionIds).toEqual([]);
  });

  test('progressively fetched route sessions retain their dock placements', () => {
    useSessionStore.setState({ sessions: [sessions[7]] });
    renderHook(() => useBoardRouteSync({ scope: { kind: 'overview' } }));
    act(() => useWorkspaceViewStore.getState().moveView(sessionViewId('server', 's7'), 'bottom'));
    act(() => useSessionStore.setState({ sessions }));
    expect(useSessionBoardStore.getState().openSessionIds).toHaveLength(12);
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, sessionViewId('server', 's7'))).toBe('bottom');
  });

  test('late session discovery from a previous client cannot populate the new server', async () => {
    route.location.search.open = 's7';
    let resolveOld!: (value: { session: Session }) => void;
    const oldGet = vi.fn(() => new Promise<{ session: Session }>((resolve) => { resolveOld = resolve; }));
    const oldClient = { http: { sessions: { get: oldGet } } } as unknown as ProkopaiClient;
    const newGet = vi.fn(async () => ({ session: { ...sessions[7], title: 'New server' } }));
    const newClient = { http: { sessions: { get: newGet } } } as unknown as ProkopaiClient;
    const { rerender } = renderHook(({ client }) => useOverviewRouteSessionLoader(client, true), { initialProps: { client: oldClient } });
    await act(async () => { rerender({ client: newClient }); });
    await act(async () => { resolveOld({ session: { ...sessions[7], title: 'Old server' } }); });
    expect(useSessionStore.getState().sessions).toHaveLength(1);
    expect(useSessionStore.getState().sessions[0].title).toBe('New server');
  });

  test('opening cached tabs preserves navigation intent while explicit message links still target the message', () => {
    useSessionStore.setState({ sessions });
    useSessionStore.getState().replaceSessionContent('s0', []);
    useSessionStore.getState().setNavigationIntentForSession('s0', { mode: 'free' });
    useSessionBoardStore.getState().openInFocusedPane('s0');
    useWorkspaceViewStore.getState().moveView(sessionViewId('server', 's0'), 'right');
    const resume = vi.fn();
    const navigate = vi.fn();
    const client = { connected: true, sessions: { resume } } as unknown as ProkopaiClient;
    const { result } = renderHook(() => useSessionCommands({
      clientRef: { current: client }, currentSession: sessions[0], sessions, workspaces: [workspace], activeWorkspace: workspace,
      streamingSessionIds: new Set(), primaryPreconfigs: [], setActiveWorkspace: vi.fn(),
      removePendingAskRequest: vi.fn(), removePendingPermissionRequest: vi.fn(), clearPendingAskRequestsBySessionId: vi.fn(), clearStreamingSessions: vi.fn(),
      pendingSessionCreateRef: { current: null }, partAppendRafRef: { current: null }, pendingPartAppendsRef: { current: new Map() }, skipFinishSoundSessionIdsRef: { current: new Set() },
      navigate, serverId: 'server', viewPath: '/workspace',
    }));
    act(() => result.current.resumeSession('s0'));
    expect(resume).not.toHaveBeenCalled();
    expect(useSessionStore.getState().navigationIntentBySessionId.s0).toEqual({ mode: 'free' });
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, sessionViewId('server', 's0'))).toBe('right');
    act(() => result.current.resumeSession('s1'));
    expect(useSessionBoardStore.getState().openSessionIds).toEqual(['s0', 's1']);
    expect(resume).toHaveBeenCalledWith('s1');
    act(() => result.current.resumeSession('s0', { targetMessageId: 'target' }));
    expect(useSessionStore.getState().navigationIntentBySessionId.s0).toEqual({ mode: 'target-message', messageId: 'target' });
  });
});
