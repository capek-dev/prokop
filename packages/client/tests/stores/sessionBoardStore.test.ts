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
