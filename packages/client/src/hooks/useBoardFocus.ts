import { useCallback } from 'react';
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { serializeOpenSessionIds } from '@/stores/sessionBoardStore';

/**
 * Derive the viewPath from the current route.
 * Matches the logic in useServerSessionManager.
 */
function useViewPath(): string {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname.includes('/overview')) return '/overview';
  return '/workspace';
}

/**
 * Atomic routed focus operation for the multi-session board.
 *
 * Focuses a pane in the board store AND updates the URL in one step,
 * so the route and the board state cannot diverge.
 *
 * Uses route replacement (not push) so ordinary pane focus changes
 * do not add noisy history entries.
 */
export function useBoardFocus() {
  const navigate = useNavigate();
  const params = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
  const serverId = params?.serverId as string | undefined;
  const viewPath = useViewPath();

  return useCallback((sessionId: string) => {
    const board = useSessionBoardStore.getState();
    if (!board.openSessionIds.includes(sessionId)) return;
    board.focusSession(sessionId);

    const state = useSessionBoardStore.getState();
    const open = serializeOpenSessionIds(state.openSessionIds.length > 1 ? state.openSessionIds : []);
    navigate({
      to: `/server/$serverId${viewPath}/session/$sessionId`,
      params: { serverId: serverId!, sessionId: state.focusedSessionId ?? sessionId },
      ...(open ? { search: { open } as Record<string, unknown> } : {}),
      replace: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }, [navigate, serverId, viewPath]);
}
