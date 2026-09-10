import type { ReactNode } from 'react';
import type { Session, Workspace } from '@prokopai/sdk';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useSessionStore } from '@/stores/sessionStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSidebarData } from '@/hooks/useSidebarData';
import { useOverviewSessions } from '@/hooks/useOverviewSessions';

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({}) }));
vi.mock('@/contexts/ServerContext', () => ({ useServerContext: () => ({ servers: [], quickConnections: [] }) }));

function session(id: string, overrides: Partial<Session> = {}): Session {
  return { id, workspaceId: 'ws', title: id, status: 'active', parentId: null, metadata: null, tags: [], ...overrides } as Session;
}

beforeEach(() => {
  useServerDataStore.setState({ activeWorkspace: { id: 'ws' } as Workspace });
  useSessionStore.getState().setSessions([
    session('normal'),
    session('excluded', { metadata: { learning: { excluded: true, includeAutomated: false } } }),
    session('review', { title: 'Renamed review', metadata: { learningRunId: 'run' } }),
    session('archived-review', { status: 'closed', metadata: { learningRunId: 'old-run' } }),
    session('archived', { status: 'closed' }),
    session('scheduled', { metadata: { scheduledJobId: 'job' } }),
  ]);
});
afterEach(() => {
  act(() => {
    useSessionStore.getState().clearSessions();
    useServerDataStore.getState().clearAll();
  });
});

test('sidebar hides learning runs from active and archived lists but preserves scheduled and ordinary conversations', () => {
  const { result } = renderHook(() => useSidebarData());
  expect(result.current.activeSessions.map(s => s.id)).toEqual(['normal', 'excluded']);
  expect(result.current.archivedSessions.map(s => s.id)).toEqual(['archived']);
  expect(result.current.scheduledSessionsByJob.get('job')?.map(s => s.id)).toEqual(['scheduled']);
  act(() => useSessionStore.getState().mergeSessions([session('live-review', { metadata: { learningRunId: 'live' } })]));
  expect(result.current.activeSessions.map(s => s.id)).toEqual(['normal', 'excluded']);
  expect(useSessionStore.getState().sessions.some(s => s.id === 'live-review')).toBe(true);
});

test('overview hides learning runs including live store updates', () => {
  const cache = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useOverviewSessions({ sdkClient: null, workspaceIds: ['ws'], connected: false }), { wrapper });
  expect(result.current.sessionsByWorkspace.ws.map(s => s.id)).toEqual(['normal', 'excluded']);
  act(() => useSessionStore.getState().mergeSessions([session('live-review', { metadata: { learningRunId: 'live' } })]));
  expect(result.current.sessionsByWorkspace.ws.map(s => s.id)).toEqual(['normal', 'excluded']);
  cache.clear();
});
