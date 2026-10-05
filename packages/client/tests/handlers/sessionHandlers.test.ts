import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Session } from '@prokopai/sdk';
import type { SessionHandlersContext } from '@/handlers/serverMessage/types';

vi.mock('@/components/providers/QueryProvider', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

import { handleSessionCreated, handleSessionForked, handleSessionUpdated } from '@/handlers/serverMessage/sessionHandlers';
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
      pendingSessionCreateRef: { current: { workspaceId: 'workspace', boardAction: 'replace-focused' } },
    } as unknown as SessionHandlersContext;
  }

  test('ordinary session creation appends a tab and keeps the previous session in its URL', () => {
    useSessionBoardStore.getState().openInFocusedPane('existing');
    const context = lifecycleContext();
    handleSessionCreated({ type: 'session.created', session: { id: 'created', workspaceId: 'workspace' } as Session }, context);
    expect(useSessionBoardStore.getState().openSessionIds).toEqual(['existing', 'created']);
    expect(context.navigateToSessionWithOpen).toHaveBeenCalledWith('created', 'existing,created');
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
