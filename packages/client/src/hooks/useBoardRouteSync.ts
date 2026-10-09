import { useEffect, useRef } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useSessionStore } from '@/stores/sessionStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import {
  useSessionBoardStore,
  parseOpenSessionIds,
} from '@/stores/sessionBoardStore';
import { useForeignSessionsStore } from '@/stores/foreignSessionsStore';

export type BoardScope =
  | { kind: 'workspace'; workspaceId: string | null }
  | { kind: 'overview' };

interface BoardRouteSyncOptions {
  scope: BoardScope;
}

/**
 * Keep the session board store synchronized with URL search params.
 *
 * URL shape: /server/$serverId/<view>/session/$focusedSessionId?open=sessA,sessB
 *
 * Validation rules applied:
 * - Deduplicate open IDs while preserving order
 * - Ensure focused session is in the open list
 * - Filter out IDs not in the valid session set
 * - Workspace scope: session must belong to scope.workspaceId
 * - Overview scope: session must belong to an accessible workspace
 * - Fall back to first valid session if focused is invalid
 */
export function useBoardRouteSync({ scope }: BoardRouteSyncOptions): void {
  const lastSyncKey = useRef<string>('');

  const searchOpen = useRouterState({
    select: (s) => {
      const search = s.location.search as Record<string, unknown>;
      return typeof search.open === 'string' ? search.open : undefined;
    },
  });

  const sessionIdFromUrl = useRouterState({
    select: (s) => {
      const params = (s.location.pathname.match(/\/session\/([^/]+)/) || [])[1];
      return params;
    },
  });

  const sessions = useSessionStore(s => s.sessions);
  const workspaces = useServerDataStore(s => s.workspaces);
  const serverId = useServerDataStore(s => s.serverId);
  const foreignById = useForeignSessionsStore(s => s.byId);

  useEffect(() => {
    // Build the valid session set based on scope
    const validIds = new Set<string>();

    if (scope.kind === 'workspace') {
      if (!scope.workspaceId) return;
      for (const session of sessions) {
        if (session.workspaceId === scope.workspaceId) {
          validIds.add(session.id);
        }
      }
    } else {
      // Overview scope: sessions from any accessible workspace
      const accessibleWorkspaceIds = new Set(workspaces.map(w => w.id));
      for (const session of sessions) {
        if (session.workspaceId && accessibleWorkspaceIds.has(session.workspaceId)) {
          validIds.add(session.id);
        }
      }
    }

    // Sessions from other machines were opened deliberately; they are valid in any scope.
    for (const id of Object.keys(foreignById)) validIds.add(id);

    // A cross-workspace open switches the workspace and focuses the board
    // before the router commits the new URL. Until it does, the route still
    // names a session of the previous workspace; hydrating from it would drop
    // the new focus for a frame (the selected row twitches). Wait for the URL.
    const boardFocus = useSessionBoardStore.getState().focusedSessionId;
    if (scope.kind === 'workspace' && sessionIdFromUrl && !validIds.has(sessionIdFromUrl)
      && sessions.some((session) => session.id === sessionIdFromUrl)
      && boardFocus && boardFocus !== sessionIdFromUrl && validIds.has(boardFocus)) {
      return;
    }

    // Parse open param
    let openIds = parseOpenSessionIds(searchOpen);

    // Determine focused session
    let focusedId = sessionIdFromUrl ?? null;

    // Filter openIds: must be in valid set
    openIds = openIds.filter(id => validIds.has(id));

    // If focused session is valid and not in open list, add it
    if (focusedId && validIds.has(focusedId) && !openIds.includes(focusedId)) {
      openIds = [focusedId, ...openIds];
    }

    // If focused session is invalid, fall back to first valid open session
    if (!focusedId || !validIds.has(focusedId)) {
      focusedId = openIds[0] ?? null;
    }

    // Sync key to avoid redundant store writes
    const syncKey = JSON.stringify([serverId, focusedId, openIds]);
    if (syncKey === lastSyncKey.current) return;
    lastSyncKey.current = syncKey;

    useSessionBoardStore.getState().hydrateFromRoute(focusedId, openIds);
  }, [serverId, searchOpen, sessionIdFromUrl, sessions, workspaces, scope, foreignById]);
}
