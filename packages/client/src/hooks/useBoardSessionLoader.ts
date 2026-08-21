import { useEffect, useRef } from 'react';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';
import type { ProkopaiClient } from '@prokopai/sdk';

/**
 * Automatically resume sessions that are visible on the board but don't have
 * content loaded or aren't subscribed to server events yet.
 *
 * This handles:
 * - Initial page load with open sessions from URL
 * - Adding a new pane (needs to load content)
 * - Reconnection after network drop
 */
export function useBoardSessionLoader(
  sdkClient: ProkopaiClient | null,
  connected: boolean,
): void {
  const resumedRef = useRef<Set<string>>(new Set());
  const openSessionIds = useSessionBoardStore(s => s.openSessionIds);

  useEffect(() => {
    if (!sdkClient || !connected) return;

    for (const sessionId of openSessionIds) {
      const hasMessages = !!useSessionStore.getState().messagesBySession[sessionId]?.length;
      const contentMeta = useSessionStore.getState().contentMetaBySession[sessionId];
      const isLoaded = contentMeta?.status === 'ready' || hasMessages;

      if (!isLoaded && !resumedRef.current.has(sessionId)) {
        resumedRef.current.add(sessionId);
        useSessionStore.getState().beginSessionContentLoad(sessionId);
        sdkClient.sessions.resume(sessionId);
      }
    }
  }, [sdkClient, connected, openSessionIds]);

  // Clear the resumed set when connection drops so we re-resume on reconnect
  useEffect(() => {
    if (!connected) {
      resumedRef.current.clear();
    }
  }, [connected]);
}
