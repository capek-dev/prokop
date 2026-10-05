import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { createDefaultViewLayout, findViewRegion, sessionViewId, useWorkspaceViewStore } from '@/stores/workspaceViewStore';

describe('session tab navigation', () => {
  beforeEach(() => {
    useServerDataStore.setState({ serverId: 'server' });
    useSessionBoardStore.setState({ openSessionIds: [], focusedSessionId: null });
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
  });
  afterEach(() => { localStorage.clear(); });

  test('normal opening appends tabs and reopening focuses a unique moved tab', () => {
    const store = useSessionBoardStore.getState();
    store.openInFocusedPane('a');
    store.openInFocusedPane('b');
    const first = sessionViewId('server', 'a');
    useWorkspaceViewStore.getState().moveView(first, 'right');
    store.openInFocusedPane('a');
    expect(useSessionBoardStore.getState()).toMatchObject({ openSessionIds: ['a', 'b'], focusedSessionId: 'a' });
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, first)).toBe('right');
    expect(Object.values(useWorkspaceViewStore.getState().layout.groups).flatMap((group) => group.viewIds).filter((id) => id === first)).toEqual([first]);
  });

  test('supports more than six sessions through both opening paths and route restoration', () => {
    const ids = Array.from({ length: 12 }, (_, i) => 'session-' + i);
    ids.forEach((id, index) => index % 2 ? useSessionBoardStore.getState().openAlongside(id) : useSessionBoardStore.getState().openInFocusedPane(id));
    expect(useSessionBoardStore.getState().openSessionIds).toEqual(ids);
    useSessionBoardStore.getState().clearBoard();
    useSessionBoardStore.getState().hydrateFromRoute(ids[8], ids);
    expect(useSessionBoardStore.getState()).toMatchObject({ openSessionIds: ids, focusedSessionId: ids[8] });
  });

  test('progressive route hydration preserves moved sessions and does not steal focus from a file', () => {
    const store = useSessionBoardStore.getState();
    store.hydrateFromRoute('a', ['a']);
    const first = sessionViewId('server', 'a');
    useWorkspaceViewStore.getState().moveView(first, 'bottom');
    useWorkspaceViewStore.getState().activateView('explorer');
    store.hydrateFromRoute('a', ['a', 'b']);
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, first)).toBe('bottom');
    expect(useWorkspaceViewStore.getState().layout.groups.right.activeId).toBe('explorer');
    expect(useWorkspaceViewStore.getState().layout.groups.bottom.activeId).toBe(first);
  });

  test('closing a session removes only its layout entry and selects its neighbor', () => {
    const store = useSessionBoardStore.getState();
    store.hydrateFromRoute('b', ['a', 'b', 'c']);
    store.removeFromBoard('b');
    expect(useSessionBoardStore.getState()).toMatchObject({ openSessionIds: ['a', 'c'], focusedSessionId: 'a' });
    expect(Object.values(useWorkspaceViewStore.getState().layout.groups).flatMap((group) => group.viewIds)).not.toContain(sessionViewId('server', 'b'));
  });

  test('fork replacement preserves placement and deduplicates an already-open target', () => {
    const store = useSessionBoardStore.getState();
    store.openInFocusedPane('a');
    useWorkspaceViewStore.getState().moveView(sessionViewId('server', 'a'), 'left');
    store.replaceSessionId('a', 'fork');
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, sessionViewId('server', 'fork'))).toBe('left');
    store.openInFocusedPane('b');
    store.replaceSessionId('b', 'fork');
    expect(useSessionBoardStore.getState().openSessionIds).toEqual(['fork']);
  });

  test('invalid-session removal and clear remove layout references', () => {
    const store = useSessionBoardStore.getState();
    store.hydrateFromRoute('b', ['a', 'b']);
    store.removeInvalidSessions(new Set(['a']));
    expect(useSessionBoardStore.getState()).toMatchObject({ openSessionIds: ['a'], focusedSessionId: 'a' });
    store.clearBoard();
    expect(useWorkspaceViewStore.getState().layout.groups.center.viewIds).toEqual(['conversations', 'editor']);
  });
});
