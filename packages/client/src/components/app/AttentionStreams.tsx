import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useRouter } from '@tanstack/react-router';
import { toast } from 'sonner';
import type { AttentionAsk, AttentionRunningSession, SavedServer } from '@prokopai/sdk';
import { useServerContext } from '@/contexts/ServerContext';
import { diffAttention, startAttentionStream, useAttentionStore } from '@/lib/attention';
import { STORAGE_KEYS } from '@/lib/storage';
import { openSessionHere } from '@/lib/openSessionHere';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';

/** Server id of the machine shown right now, from the URL. */
function activeServerId(pathname: string): string | null {
  return /^\/server\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

/**
 * Follows every saved machine's attention stream and raises prompts for
 * machines other than the one on screen (that one already shows its own asks).
 * Mounted once, at the root.
 */
export function AttentionStreams() {
  const { servers } = useServerContext();
  const router = useRouter();
  const serversRef = useRef(servers);
  // Layout effects run before the stream effect below, so it reads the current list.
  useLayoutEffect(() => {
    serversRef.current = servers;
  });

  // Restart a stream only when something that affects the connection changes.
  const connectionKey = useMemo(
    () => servers.map((server) => `${server.id}|${server.url}|${server.token ?? ''}|${(server.routes ?? []).join(',')}`).join('\n'),
    [servers],
  );

  useEffect(() => {
    const switchTo = (serverId: string, sessionId: string, workspaceId: string | null) => {
      if (workspaceId) localStorage.setItem(STORAGE_KEYS.ACTIVE_WORKSPACE_ID, workspaceId);
      void router.navigate({ to: '/server/$serverId/workspace/session/$sessionId', params: { serverId, sessionId } });
    };
    // On another machine's board, open the session as a tab beside your work;
    // without a board on screen (or if that fails), switch machines instead.
    const open = (server: SavedServer, sessionId: string, workspaceId: string | null) => {
      const pathname = router.state.location.pathname;
      const active = activeServerId(pathname);
      if (!active || active === server.id) {
        switchTo(server.id, sessionId, workspaceId);
        return;
      }
      void openSessionHere({
        server,
        sessionId,
        activeServerId: active,
        viewPath: pathname.includes('/overview') ? '/overview' : '/workspace',
        navigate: (options) => void router.navigate(options as never),
      }).catch(() => switchTo(server.id, sessionId, workspaceId));
    };
    const label = (title: string | null, workspaceName: string | null) =>
      [title ?? 'Untitled session', workspaceName].filter(Boolean).join(' · ');

    const promptAsk = (server: SavedServer, ask: AttentionAsk) => {
      toast(`${ask.kind === 'approval' ? 'Approval' : 'Answer'} needed on ${server.name}`, {
        id: `attention-${server.id}-${ask.id}`,
        description: label(ask.sessionTitle, ask.workspaceName),
        duration: Infinity,
        action: { label: 'Open', onClick: () => open(server, ask.sessionId, ask.workspaceId) },
      });
    };
    const promptFinished = (server: SavedServer, session: AttentionRunningSession) => {
      toast(`Finished on ${server.name}`, {
        id: `attention-${server.id}-finished-${session.sessionId}`,
        description: label(session.sessionTitle, session.workspaceName),
        action: { label: 'Open', onClick: () => open(server, session.sessionId, session.workspaceId) },
      });
    };

    const stops = serversRef.current.map((server) => startAttentionStream(server, (previous, next) => {
      const changes = diffAttention(previous, next);
      for (const id of changes.resolvedAskIds) toast.dismiss(`attention-${server.id}-${id}`);
      if (activeServerId(router.state.location.pathname) === server.id) return;
      // A session already open as a tab shows its own approvals there.
      const open = new Set(useSessionBoardStore.getState().openSessionIds);
      for (const ask of changes.newAsks) if (!open.has(ask.sessionId)) promptAsk(server, ask);
      for (const session of changes.finished) promptFinished(server, session);
    }));
    const ids = new Set(serversRef.current.map((server) => server.id));
    for (const id of Object.keys(useAttentionStore.getState().hosts)) {
      if (!ids.has(id)) useAttentionStore.getState().remove(id);
    }
    return () => stops.forEach((stop) => stop());
  }, [connectionKey, router]);

  return null;
}
