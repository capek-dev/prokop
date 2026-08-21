import { useCallback, useRef } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useSessionStore } from '@/stores/sessionStore';

interface UseTranscriptPaginationParams {
  sessionId: string | undefined;
  client: ProkopaiClient | null;
}

export function useTranscriptPagination({
  sessionId,
  client,
}: UseTranscriptPaginationParams) {
  const loadingRef = useRef(false);

  const loadOlder = useCallback(async () => {
    if (!sessionId || !client) return;
    if (loadingRef.current) return;

    const store = useSessionStore.getState();
    const meta = store.contentMetaBySession[sessionId];
    if (!meta || meta.status !== 'ready') return;
    if (!meta.hasOlder) return;
    if (meta.isLoadingOlder) return;
    if (!meta.oldestSequence) return;

    loadingRef.current = true;
    store.beginOlderContentLoad(sessionId);

    try {
      const response = await client.http.sessions.getTranscriptPage(sessionId, {
        before: meta.oldestSequence,
        limit: 50,
      });

      useSessionStore.getState().prependSessionContentPage(sessionId, response.messages, {
        hasOlder: response.pagination.hasOlder,
        oldestSequence: response.pagination.oldestSequence,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      useSessionStore.getState().failOlderContentLoad(sessionId, message);
    } finally {
      loadingRef.current = false;
    }
  }, [sessionId, client]);

  return { loadOlder };
}
