import { useEffect } from 'react';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useCompletionStore } from '@/stores/completionStore';

/**
 * Clears a session's "finished, not seen" mark once you look at it: its pane
 * is focused while the window is in front. Opening a session clears it too
 * (session.resumed); this covers switching to an already-open tab and coming
 * back to the window.
 */
export function UnreadTracker() {
  const focusedId = useSessionBoardStore((s) => s.focusedSessionId);
  const focusedUnread = useCompletionStore((s) => (focusedId ? s.completionState.has(focusedId) : false));

  useEffect(() => {
    if (!focusedId || !focusedUnread) return;
    const markSeen = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        useCompletionStore.getState().clearCompletion(focusedId);
      }
    };
    markSeen();
    window.addEventListener('focus', markSeen);
    document.addEventListener('visibilitychange', markSeen);
    return () => {
      window.removeEventListener('focus', markSeen);
      document.removeEventListener('visibilitychange', markSeen);
    };
  }, [focusedId, focusedUnread]);

  return null;
}
