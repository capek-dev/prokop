import { useEffect } from 'react';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useForeignSessionsStore } from '@/stores/foreignSessionsStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useAskStore } from '@/stores/askStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { getWorkspaceDisplayName } from '@/lib/workspaceKind';

export const APP_TITLE = 'Prokop';

/** Marks the window while an agent works or waits for an answer. */
const ACTIVITY_MARK = '● ';

export function formatWindowTitle(parts: {
  sessionTitle?: string | null;
  workspaceName?: string | null;
  active: boolean;
}): string {
  const name = [parts.sessionTitle, parts.workspaceName].filter(Boolean).join(' · ') || APP_TITLE;
  return parts.active ? `${ACTIVITY_MARK}${name}` : name;
}

/**
 * Names the window after the focused session and its workspace, so the app
 * switcher, Dock, and window menu show what each window is doing.
 */
export function WindowTitle() {
  const focusedId = useSessionBoardStore((s) => s.focusedSessionId);
  const session = useSessionStore((s) => (focusedId ? s.sessions.find((x) => x.id === focusedId) : undefined));
  const foreign = useForeignSessionsStore((s) => (focusedId ? s.byId[focusedId]?.session : undefined));
  const shown = session ?? foreign;
  const streaming = useConnectionStore((s) => (focusedId ? s.streamingSessionIds.has(focusedId) : false));
  const waiting = useAskStore((s) => s.pendingRequests.length > 0);
  const workspaceName = useServerDataStore((s) => {
    const workspace = s.workspaces.find((w) => w.id === shown?.workspaceId) ?? s.activeWorkspace;
    return workspace ? getWorkspaceDisplayName(workspace, s.agents) : null;
  });

  const title = formatWindowTitle({
    sessionTitle: shown ? shown.title || 'Untitled' : null,
    workspaceName,
    active: waiting || streaming || !!shown?.runningAt,
  });

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => () => {
    document.title = APP_TITLE;
  }, []);

  return null;
}
