import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient, Session, Workspace } from '@prokopai/sdk';

const route = vi.hoisted(() => ({ location: { pathname: '/server/studio/workspace/session/local-1', search: { open: '' } } }));
vi.mock('@tanstack/react-router', () => ({ useRouterState: ({ select }: { select: (state: typeof route) => unknown }) => select(route) }));

const pool = vi.hoisted(() => ({ client: null as ProkopaiClient | null }));
vi.mock('@/lib/hostClientPool', () => ({
  foreignClientFor: (sessionId: string) => (sessionId === 'remote-1' ? pool.client : null),
}));

import { useBoardRouteSync } from '@/hooks/useBoardRouteSync';
import { useSessionCommands } from '@/hooks/useSessionCommands';
import { useForeignSessionsStore } from '@/stores/foreignSessionsStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useAskStore } from '@/stores/askStore';
import { createDefaultViewLayout, sessionViewId, useWorkspaceViewStore } from '@/stores/workspaceViewStore';

const workspace = { id: 'w-local', name: 'jean2', path: '/p' } as Workspace;
const local = { id: 'local-1', workspaceId: 'w-local', title: 'Local' } as Session;
const remote = { id: 'remote-1', workspaceId: 'w-remote', title: 'Remote' } as Session;

function fakeClient(): ProkopaiClient {
  return {
    connected: true,
    chat: { send: vi.fn() },
    sessions: { resume: vi.fn(), close: vi.fn(), interrupt: vi.fn() },
    send: vi.fn(),
    control: { claim: vi.fn() },
  } as unknown as ProkopaiClient;
}

function commands(activeClient: ProkopaiClient) {
  return renderHook(() => useSessionCommands({
    clientRef: { current: activeClient }, currentSession: local, sessions: [local], workspaces: [workspace], activeWorkspace: workspace,
    streamingSessionIds: new Set(), primaryPreconfigs: [], setActiveWorkspace: vi.fn(),
    removePendingAskRequest: vi.fn(), removePendingPermissionRequest: vi.fn(), clearPendingAskRequestsBySessionId: vi.fn(), clearStreamingSessions: vi.fn(),
    pendingSessionCreateRef: { current: null }, partAppendRafRef: { current: null }, pendingPartAppendsRef: { current: new Map() }, skipFinishSoundSessionIdsRef: { current: new Set() },
    navigate: vi.fn(), serverId: 'studio', viewPath: '/workspace',
  })).result.current;
}

beforeEach(() => {
  localStorage.clear();
  useServerDataStore.setState({ serverId: 'studio', activeWorkspace: workspace, workspaces: [workspace] });
  useSessionStore.setState({ ...useSessionStore.getInitialState(), sessions: [local] });
  useSessionBoardStore.setState({ openSessionIds: [], focusedSessionId: null });
  useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
  useForeignSessionsStore.setState({ byId: {} });
  useForeignSessionsStore.getState().add('laptop', remote);
  useAskStore.setState({ pendingRequests: [] });
  pool.client = fakeClient();
});

afterEach(cleanup);

describe('sessions from another machine', () => {
  test('commands for a foreign session go to its machine, local ones to the active machine', () => {
    const active = fakeClient();
    const run = commands(active);

    run.sendChatMessageForSession('remote-1', 'hello from studio');
    run.sendChatMessageForSession('local-1', 'hello local');
    run.handleInterruptSessionById('remote-1');

    expect(pool.client!.chat.send).toHaveBeenCalledWith('remote-1', 'hello from studio', expect.anything());
    expect(active.chat.send).toHaveBeenCalledWith('local-1', 'hello local', expect.anything());
    expect(active.chat.send).not.toHaveBeenCalledWith('remote-1', expect.anything(), expect.anything());
    expect(pool.client!.sessions.interrupt).toHaveBeenCalledWith('remote-1');
    expect(active.sessions.interrupt).not.toHaveBeenCalled();
  });

  test('answering an approval goes to the machine that asked', () => {
    useAskStore.setState({ pendingRequests: [{ toolCallId: 'call-1', sessionId: 'remote-1', toolName: 'bash', ask: {} as never, requestId: 'req-1' }] });
    const active = fakeClient();
    commands(active).handleAskResponse('call-1', { approved: true } as never, 'req-1');
    expect(pool.client!.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'ask.response', toolCallId: 'call-1', requestId: 'req-1' }));
    expect(active.send).not.toHaveBeenCalled();
  });

  test('opening a foreign session resumes it on its machine without switching workspaces', () => {
    const active = fakeClient();
    commands(active).resumeSession('remote-1', { skipNavigation: true });
    expect(pool.client!.sessions.resume).toHaveBeenCalledWith('remote-1');
    expect(active.sessions.resume).not.toHaveBeenCalled();
    expect(useSessionBoardStore.getState().openSessionIds).toEqual(['remote-1']);
    expect(useServerDataStore.getState().activeWorkspace?.id).toBe('w-local');
  });

  test('foreign tabs survive route sync and keep their machine in the view id', () => {
    route.location.search.open = 'local-1,remote-1';
    renderHook(() => useBoardRouteSync({ scope: { kind: 'workspace', workspaceId: 'w-local' } }));
    expect(useSessionBoardStore.getState().openSessionIds).toEqual(['local-1', 'remote-1']);

    useSessionBoardStore.getState().focusSession('remote-1');
    const layoutViews = JSON.stringify(useWorkspaceViewStore.getState().layout);
    expect(layoutViews).toContain(sessionViewId('laptop', 'remote-1'));
    expect(layoutViews).toContain(sessionViewId('studio', 'local-1'));
  });

  test('closing a foreign tab forgets the session', () => {
    useSessionBoardStore.getState().openInFocusedPane('remote-1');
    useSessionBoardStore.getState().removeFromBoard('remote-1');
    expect(useForeignSessionsStore.getState().byId['remote-1']).toBeUndefined();
  });

  test('foreign sessions persist across reloads', async () => {
    expect(JSON.parse(localStorage.getItem('prokopai_foreign_sessions')!)).toMatchObject({ 'remote-1': { serverId: 'laptop' } });
  });
});
