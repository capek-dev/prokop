import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Session } from '@prokopai/sdk';
import type { SessionHandlersContext } from '@/handlers/serverMessage/types';

vi.mock('@/components/providers/QueryProvider', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

import { queryClient } from '@/components/providers/QueryProvider';
import { handleSessionCreated, handleSessionForked, handleSessionRenamed, handleSessionUpdated } from '@/handlers/serverMessage/sessionHandlers';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { createDefaultViewLayout, findViewRegion, sessionViewId, useWorkspaceViewStore } from '@/stores/workspaceViewStore';

function createContext(): SessionHandlersContext {
  return {
    setSessions: vi.fn((updater: (sessions: Session[]) => Session[]) => updater([])),
    setModelForSession: vi.fn(),
    setVariantForSession: vi.fn(),
  } as unknown as SessionHandlersContext;
}

describe('handleSessionUpdated', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    usePendingOperationsStore.setState({ operations: [] });
  });

  test('acknowledges a pending compaction when the server reports it started', () => {
    vi.spyOn(Date, 'now').mockReturnValue(25_000);
    usePendingOperationsStore.getState().startOperation({
      type: 'compact',
      sessionId: 'session-1',
      startedAt: 20_000,
    });

    handleSessionUpdated({
      type: 'session.updated',
      session: {
        id: 'session-1',
        compacting: true,
      } as Session,
    }, createContext());

    expect(usePendingOperationsStore.getState().operations[0]).toMatchObject({
      type: 'compact',
      sessionId: 'session-1',
      acknowledgedAt: 25_000,
    });
  });
});

describe('session.updated keeps every list current without refetching on each change', () => {
  const session = (overrides: Partial<Session> = {}): Session => ({
    id: 'root', workspaceId: 'ws', parentId: null, status: 'active', title: 'Root', tags: [],
    runningAt: null, metadata: null, updatedAt: '2026-10-06T10:00:00.000Z', ...overrides,
  }) as Session;

  /** A store-backed setSessions, so handlers see what is already listed. */
  function listContext(initial: Session[]) {
    let sessions = initial;
    const context = {
      ...createContext(),
      setSessions: vi.fn((updater: Session[] | ((prev: Session[]) => Session[])) => {
        sessions = typeof updater === 'function' ? updater(sessions) : updater;
      }),
    } as unknown as SessionHandlersContext;
    return { context, list: () => sessions };
  }

  const invalidate = vi.mocked(queryClient.invalidateQueries);
  const listKey = (workspaceId: string) => ['sessions', 'workspace', 'infinite', { workspaceId, limit: 100, rootOnly: true, category: 'active' }];
  /** Whether any invalidation call covers this query key. */
  const refetched = (key: readonly unknown[]) => invalidate.mock.calls.some(([filters]) => {
    const { predicate, queryKey } = filters as { predicate?: (query: { queryKey: readonly unknown[] }) => boolean; queryKey?: readonly unknown[] };
    return predicate ? predicate({ queryKey: key }) : JSON.stringify(queryKey) === JSON.stringify(key);
  });

  beforeEach(() => invalidate.mockClear());

  test('a run starting, a rename, or a token update changes the row in place and refetches nothing', () => {
    const { context, list } = listContext([session()]);
    const runningAt = '2026-10-06T10:01:00.000Z';
    handleSessionUpdated({ type: 'session.updated', session: session({ runningAt }) }, context);
    handleSessionUpdated({ type: 'session.updated', session: session({ runningAt, title: 'Fix login', totalTokens: 900 }) }, context);

    expect(list()).toEqual([session({ runningAt, title: 'Fix login', totalTokens: 900 })]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  test('a run finishing refreshes open usage cards, other idle updates do not', () => {
    const { context } = listContext([session({ runningAt: '2026-10-06T10:01:00.000Z' })]);
    handleSessionUpdated({ type: 'session.updated', session: session() }, context);

    expect(refetched(['providers', 'usage'])).toBe(true);
    expect(refetched(['harnesses', 'usage'])).toBe(true);
    expect(refetched(listKey('ws'))).toBe(false);

    invalidate.mockClear();
    handleSessionUpdated({ type: 'session.updated', session: session({ title: 'Renamed' }) }, context);
    expect(invalidate).not.toHaveBeenCalled();
  });

  test('a rename from any client updates the title in place', () => {
    const { context, list } = listContext([session()]);
    handleSessionRenamed({ type: 'session.renamed', session: session({ title: 'Auto title' }) }, context);

    expect(list()[0]?.title).toBe('Auto title');
    expect(invalidate).not.toHaveBeenCalled();
  });

  test('archiving or unarchiving on another device moves the session between lists', () => {
    const { context, list } = listContext([session()]);
    handleSessionUpdated({ type: 'session.updated', session: session({ status: 'closed' }) }, context);

    expect(list()[0]?.status).toBe('closed');
    expect(refetched(listKey('ws'))).toBe(true);
    expect(refetched(['sessions', 'counts', 'ws'])).toBe(true);
    expect(refetched(listKey('other-ws'))).toBe(false);
  });

  test('an unseen root session (scheduled run, fork, created elsewhere) is listed and lists refresh', () => {
    const { context, list } = listContext([session()]);
    handleSessionUpdated({ type: 'session.updated', session: session({ id: 'scheduled', metadata: { scheduledJobId: 'job-1' } }) }, context);

    expect(list().map(s => s.id)).toEqual(['scheduled', 'root']);
    expect(refetched(listKey('ws'))).toBe(true);
  });

  test('an unseen sub-session is listed under its parent without refetching root lists', () => {
    const { context, list } = listContext([session()]);
    handleSessionUpdated({ type: 'session.updated', session: session({ id: 'child', parentId: 'root' }) }, context);

    expect(list().map(s => s.id)).toEqual(['child', 'root']);
    expect(invalidate).not.toHaveBeenCalled();
  });

  test('tag edits refresh the tag list only', () => {
    const { context } = listContext([session()]);
    handleSessionUpdated({ type: 'session.updated', session: session({ tags: ['bugs'] }) }, context);

    expect(refetched(['sessions', 'tags', 'ws'])).toBe(true);
    expect(refetched(listKey('ws'))).toBe(false);
  });

  test('moving a session to another workspace refreshes both workspaces', () => {
    const { context } = listContext([session()]);
    handleSessionUpdated({ type: 'session.updated', session: session({ workspaceId: 'ws-2' }) }, context);

    expect(refetched(listKey('ws'))).toBe(true);
    expect(refetched(listKey('ws-2'))).toBe(true);
  });

  test('created and forked events never list a session twice', () => {
    const { context, list } = listContext([session({ id: 'fork' }), session()]);
    const lifecycle = {
      ...context,
      replaceSessionContent: vi.fn(), sessionAccessTimesRef: { current: new Map() }, partIdIndexRef: { current: new Map() },
      clearCompletion: vi.fn(), setUsageForSession: vi.fn(), navigateToSessionWithOpen: vi.fn(), resumeSessionAfterCreate: vi.fn(),
      pendingSessionCreateRef: { current: null },
    } as unknown as SessionHandlersContext;

    handleSessionForked({ type: 'session.forked', originalSessionId: 'root', forkedSession: session({ id: 'fork' }), messages: [] }, lifecycle);
    handleSessionCreated({ type: 'session.created', session: session({ id: 'fork' }) }, lifecycle);

    expect(list().map(s => s.id)).toEqual(['fork', 'root']);
  });
});

describe('session tab lifecycle navigation', () => {
  beforeEach(() => {
    useServerDataStore.setState({ serverId: 'server' });
    useSessionBoardStore.setState({ openSessionIds: [], focusedSessionId: null });
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
  });

  function lifecycleContext(): SessionHandlersContext {
    return {
      ...createContext(),
      replaceSessionContent: vi.fn(),
      sessionAccessTimesRef: { current: new Map() },
      partIdIndexRef: { current: new Map() },
      clearCompletion: vi.fn(), setUsageForSession: vi.fn(),
      navigateToSessionWithOpen: vi.fn(), navigateToSession: vi.fn(), resumeSessionAfterCreate: vi.fn(),
      pendingSessionCreateRef: { current: { sessionId: 'created', workspaceId: 'workspace', boardAction: 'replace-focused' } },
    } as unknown as SessionHandlersContext;
  }

  test('ordinary session creation appends a tab and keeps the previous session in its URL', () => {
    useSessionBoardStore.getState().openInFocusedPane('existing');
    const context = lifecycleContext();
    handleSessionCreated({ type: 'session.created', session: { id: 'created', workspaceId: 'workspace' } as Session }, context);
    expect(useSessionBoardStore.getState().openSessionIds).toEqual(['existing', 'created']);
    expect(context.navigateToSessionWithOpen).toHaveBeenCalledWith('created', 'existing,created');
  });

  test('a sub-agent or other device creating a session mid-create does not take its place', () => {
    useSessionBoardStore.getState().openInFocusedPane('existing');
    const context = lifecycleContext();

    handleSessionCreated({ type: 'session.created', session: { id: 'subagent', parentId: 'existing', workspaceId: 'workspace' } as Session }, context);
    expect(useSessionBoardStore.getState().openSessionIds).toEqual(['existing']);
    expect(context.navigateToSessionWithOpen).not.toHaveBeenCalled();
    expect(context.pendingSessionCreateRef.current).not.toBeNull();

    handleSessionCreated({ type: 'session.created', session: { id: 'created', workspaceId: 'workspace' } as Session }, context);
    expect(useSessionBoardStore.getState().openSessionIds).toEqual(['existing', 'created']);
    expect(context.navigateToSessionWithOpen).toHaveBeenCalledWith('created', 'existing,created');
    expect(context.pendingSessionCreateRef.current).toBeNull();
  });

  test('fork keeps the replaced tab placement and preserves unrelated tabs in the URL', () => {
    useSessionBoardStore.getState().hydrateFromRoute('original', ['original', 'other']);
    useWorkspaceViewStore.getState().moveView(sessionViewId('server', 'original'), 'right');
    const context = lifecycleContext();
    handleSessionForked({ type: 'session.forked', originalSessionId: 'original', forkedSession: { id: 'fork', workspaceId: 'workspace' } as Session, messages: [] }, context);
    expect(useSessionBoardStore.getState().openSessionIds).toEqual(['fork', 'other']);
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, sessionViewId('server', 'fork'))).toBe('right');
    expect(context.navigateToSessionWithOpen).toHaveBeenCalledWith('fork', 'fork,other');
    expect(context.navigateToSession).not.toHaveBeenCalled();
  });
});
