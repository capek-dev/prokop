import { HttpClient, HttpNamespace, type SavedServer } from '@prokopai/sdk';
import { navigateBoard } from '@/lib/boardNavigate';
import { foreignClientFor } from '@/lib/hostClientPool';
import { resolveHostUrl } from '@/lib/hostRoutes';
import type { NavigateFunction } from '@/lib/types';
import { useForeignSessionsStore } from '@/stores/foreignSessionsStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';

export interface OpenSessionHereInput {
  /** Machine the session belongs to. */
  server: SavedServer;
  sessionId: string;
  /** Machine shown right now; its board receives the tab. */
  activeServerId: string;
  viewPath: '/workspace' | '/overview';
  navigate: NavigateFunction;
}

/**
 * Opens another machine's session as a tab on the current board, beside local
 * sessions, without switching machines. The session's own machine serves it
 * through the pooled connection the tab holds.
 */
export async function openSessionHere(input: OpenSessionHereInput): Promise<void> {
  const { server, sessionId } = input;
  const url = await resolveHostUrl(server);
  const http = new HttpNamespace(new HttpClient({ url, ...(server.token ? { token: server.token } : {}) }));
  const { session } = await http.sessions.get(sessionId);
  useForeignSessionsStore.getState().add(server.id, session);

  // A connection already held by another tab of this machine loads it now;
  // otherwise the new tab's connection resumes it once connected.
  const client = foreignClientFor(sessionId);
  if (client?.connected) {
    useSessionStore.getState().beginSessionContentLoad(sessionId);
    client.sessions.resume(sessionId);
  }

  const board = useSessionBoardStore.getState();
  if (board.openSessionIds.includes(sessionId)) board.focusSession(sessionId);
  else board.openInFocusedPane(sessionId);
  navigateBoard(input.navigate, input.viewPath, input.activeServerId);
}
