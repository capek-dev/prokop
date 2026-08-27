import { beforeEach, describe, expect, test } from 'vitest';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';

describe('sessionBoardStore layout modes', () => {
  beforeEach(() => {
    useSessionBoardStore.setState({
      openSessionIds: [],
      focusedSessionId: null,
      layoutMode: 'focused',
    });
  });

  test('opens a normal session in the focused layout', () => {
    useSessionBoardStore.getState().openInFocusedPane('session-a');

    expect(useSessionBoardStore.getState()).toMatchObject({
      openSessionIds: ['session-a'],
      focusedSessionId: 'session-a',
      layoutMode: 'focused',
    });
  });

  test('open alongside preserves both sessions and reveals the board', () => {
    const store = useSessionBoardStore.getState();
    store.openInFocusedPane('session-a');
    store.openAlongside('session-b');

    expect(useSessionBoardStore.getState()).toMatchObject({
      openSessionIds: ['session-a', 'session-b'],
      focusedSessionId: 'session-b',
      layoutMode: 'board',
    });
  });

  test('switching to focused layout does not close other sessions', () => {
    const store = useSessionBoardStore.getState();
    store.openInFocusedPane('session-a');
    store.openAlongside('session-b');
    store.setLayoutMode('focused');

    expect(useSessionBoardStore.getState()).toMatchObject({
      openSessionIds: ['session-a', 'session-b'],
      focusedSessionId: 'session-b',
      layoutMode: 'focused',
    });
  });

  test('restores board layout when the initial route contains multiple sessions', () => {
    useSessionBoardStore.getState().hydrateFromRoute(
      'session-b',
      ['session-a', 'session-b'],
    );

    expect(useSessionBoardStore.getState()).toMatchObject({
      openSessionIds: ['session-a', 'session-b'],
      focusedSessionId: 'session-b',
      layoutMode: 'board',
    });
  });

  test('reveals board when progressive hydration grows past one session', () => {
    // Overview F5: the focused session validates first, other route `open`
    // IDs join the store one fetch later. The second hydration pass must
    // still reveal the board instead of keeping the focused tab layout.
    useSessionBoardStore.getState().hydrateFromRoute(
      'session-b',
      ['session-b'],
    );
    expect(useSessionBoardStore.getState().layoutMode).toBe('focused');

    useSessionBoardStore.getState().hydrateFromRoute(
      'session-b',
      ['session-a', 'session-b', 'session-c'],
    );

    expect(useSessionBoardStore.getState()).toMatchObject({
      openSessionIds: ['session-a', 'session-b', 'session-c'],
      focusedSessionId: 'session-b',
      layoutMode: 'board',
    });
  });

  test('restores the persisted tabs preference on route hydration', () => {
    localStorage.setItem('prokopai_board_layout_preference', 'tabs');
    useSessionBoardStore.getState().hydrateFromRoute(
      'session-b',
      ['session-a', 'session-b'],
    );

    expect(useSessionBoardStore.getState().layoutMode).toBe('tabs');
  });

  test('setLayoutMode persists multi-pane preferences but not focused', () => {
    useSessionBoardStore.getState().setLayoutMode('tabs');
    expect(localStorage.getItem('prokopai_board_layout_preference')).toBe('tabs');

    useSessionBoardStore.getState().setLayoutMode('board');
    expect(localStorage.getItem('prokopai_board_layout_preference')).toBe('board');

    useSessionBoardStore.getState().setLayoutMode('focused');
    expect(localStorage.getItem('prokopai_board_layout_preference')).toBe('board');
  });

  test('returns to focused layout when only one session remains', () => {
    const store = useSessionBoardStore.getState();
    store.openInFocusedPane('session-a');
    store.openAlongside('session-b');
    store.removeFromBoard('session-b');

    expect(useSessionBoardStore.getState()).toMatchObject({
      openSessionIds: ['session-a'],
      focusedSessionId: 'session-a',
      layoutMode: 'focused',
    });
  });
});
