import { useEffect, useRef } from 'react';
import { useRouterState } from '@tanstack/react-router';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useSessionStore } from '@/stores/sessionStore';
import { parseOpenSessionIds } from '@/stores/sessionBoardStore';

/**
 * On F5 in either workspace view, route `open` IDs may not exist in `sessionStore` yet,
 * or may be beyond the first bounded page. This hook fetches them directly
 * via `sdkClient.http.sessions.get()` and merges them into the store so
 * that `useBoardRouteSync` can validate them on the next cycle.
 *
 * Sessions that are already in the store are skipped.
 * Sessions that fail to load (404, etc.) are simply left absent, which
 * causes the route sync to eventually filter them out.
 */
export function useOverviewRouteSessionLoader(
  sdkClient: ProkopaiClient | null,
  connected: boolean,
): void {
  const sessions = useSessionStore(s => s.sessions);
  const upsertSession = useSessionStore(s => s.upsertSession);
  const fetchedRef = useRef<Set<string>>(new Set());
  const generationRef = useRef(0);

  useEffect(() => {
    fetchedRef.current.clear();
    generationRef.current += 1;
    return () => { generationRef.current += 1; };
  }, [sdkClient]);

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

  useEffect(() => {
    if (!sdkClient || !connected) return;
    const generation = generationRef.current;

    // Collect all route session IDs (focused + open)
    const routeIds = new Set<string>();
    const openIds = parseOpenSessionIds(searchOpen);
    for (const id of openIds) routeIds.add(id);
    if (sessionIdFromUrl) routeIds.add(sessionIdFromUrl);

    if (routeIds.size === 0) return;

    // Find IDs that are not in the session store and haven't been fetched yet
    const knownIds = new Set(sessions.map(s => s.id));
    const unknownIds = [...routeIds].filter(
      id => !knownIds.has(id) && !fetchedRef.current.has(id),
    );

    if (unknownIds.length === 0) return;

    for (const id of unknownIds) {
      fetchedRef.current.add(id);
      sdkClient.http.sessions.get(id).then((response: { session: import('@prokopai/sdk').Session }) => {
        if (generation !== generationRef.current) return;
        // The list may have loaded meanwhile; refresh in place instead of moving it.
        upsertSession(response.session);
      }).catch(() => {
        // Session not found or error - leave it absent.
        // Route sync will eventually filter it out.
      });
    }
  }, [sdkClient, connected, searchOpen, sessionIdFromUrl, sessions, upsertSession]);
}
