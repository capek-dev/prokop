import { useContext, type ReactNode } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { ProkopaiClient } from '@prokopai/sdk';
import { WorkspaceSessionView } from '@/components/app/WorkspaceSessionView';
import { ForeignSessionView } from '@/components/app/ForeignSessionView';
import { useForeignSessionsStore } from '@/stores/foreignSessionsStore';
import { ServerContext } from '@/contexts/ServerContext';
import type { WorkspaceTab } from '@/components/app/workspaceTab';
import { useBoardFocus } from '@/hooks/useBoardFocus';
import { useBoardSessionLoader } from '@/hooks/useBoardSessionLoader';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { sessionViewId, type WorkspaceViewId } from '@/stores/workspaceViewStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useAskStore } from '@/stores/askStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { navigateBoard } from '@/lib/boardNavigate';
import { getWorkspaceDisplayName } from '@/lib/workspaceKind';
import { useSessionPaneRegistry } from '@/contexts/SessionPaneRegistryContext';

export function useWorkspaceSessionTabs(serverId: string | undefined, sdkClient: ProkopaiClient | null, serverUrl: string | null): {
  views: Partial<Record<WorkspaceViewId, ReactNode>>;
  tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>>;
  mobileSessionId?: WorkspaceViewId;
} {
  const openIds = useSessionBoardStore((state) => state.openSessionIds);
  const focusedId = useSessionBoardStore((state) => state.focusedSessionId);
  const localSessions = useSessionStore((state) => state.sessions);
  const foreignById = useForeignSessionsStore((state) => state.byId);
  // Machine names only label tabs from other machines; optional outside the app shell.
  const servers = useContext(ServerContext)?.servers ?? [];
  const requests = useAskStore((state) => state.pendingRequests);
  const streamingIds = useConnectionStore((state) => state.streamingSessionIds);
  const connected = useConnectionStore((state) => state.connected);
  const workspaces = useServerDataStore((state) => state.workspaces);
  const agents = useServerDataStore((state) => state.agents);
  const focus = useBoardFocus();
  const paneRegistry = useSessionPaneRegistry();
  const navigate = useNavigate();
  const viewPath = useRouterState({ select: (state) => state.location.pathname.includes('/overview') ? '/overview' : '/workspace' });
  useBoardSessionLoader(sdkClient, connected);

  const views: Partial<Record<WorkspaceViewId, ReactNode>> = {};
  const tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>> = {};
  if (!serverId) return { views, tabs };
  const foreignSessions = Object.values(foreignById).map((entry) => entry.session);
  const sessions = [...localSessions, ...foreignSessions];
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const serverNames = new Map(servers.map((server) => [server.id, server.name]));
  const viewIdFor = (id: string) => sessionViewId(foreignById[id]?.serverId ?? serverId, id);
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace.id, getWorkspaceDisplayName(workspace, agents)]));
  const needsInputIds = new Set<string>();
  const runningIds = new Set(streamingIds);
  const addAncestors = (id: string, target: Set<string>) => {
    const visited = new Set<string>();
    let current: string | undefined = id;
    while (current && !visited.has(current)) {
      visited.add(current);
      target.add(current);
      current = sessionsById.get(current)?.parentId ?? undefined;
    }
  };
  for (const request of requests) {
    addAncestors(request.sessionId, needsInputIds);
    if (request.originSessionId) addAncestors(request.originSessionId, needsInputIds);
  }
  for (const session of sessions) {
    if (session.runningAt || session.subagentStatus === 'running') runningIds.add(session.id);
    if (session.subagentStatus === 'running' && session.harnessState?.capabilities.subagentActivityPropagates === true) {
      addAncestors(session.id, runningIds);
    }
  }
  for (const id of openIds) {
    const session = sessionsById.get(id);
    const foreignServerId = foreignById[id]?.serverId;
    const viewId = viewIdFor(id);
    // Another machine's tab is labelled with that machine instead of a local workspace.
    const workspaceName = foreignServerId ? serverNames.get(foreignServerId) : session && workspaceNames.get(session.workspaceId);
    const title = session?.title || 'Untitled session';
    const label = workspaceName ? `${workspaceName} / ${title}` : title;
    const status = needsInputIds.has(id) ? 'Needs input' : runningIds.has(id) ? 'Running' : undefined;
    views[viewId] = foreignServerId
      ? <ForeignSessionView serverId={foreignServerId} sessionId={id} />
      : <WorkspaceSessionView sessionId={id} sdkClient={sdkClient} serverUrl={serverUrl} />;
    tabs[viewId] = {
      label,
      status,
      onActivate: () => {
        focus(id);
        requestAnimationFrame(() => {
          const host = document.getElementById(`workspace-view-${viewId}`);
          if (useSessionBoardStore.getState().focusedSessionId !== id || !host || host.closest('[inert], [aria-hidden="true"]')) return;
          // Wait for the selected portal to become visible and register its pane.
          // Do not steal focus if another dock was selected in the meantime.
          const group = host.closest('[data-view-group], [data-mobile-tab-group]');
          if (group?.contains(document.activeElement)) paneRegistry.getHandle(id)?.focusInput();
        });
      },
      onClose: () => {
        useSessionBoardStore.getState().removeFromBoard(id);
        navigateBoard(navigate, viewPath, serverId);
      },
      onCloseOthers: openIds.length > 1 ? () => {
        const store = useSessionBoardStore.getState();
        for (const other of store.openSessionIds) if (other !== id) store.removeFromBoard(other);
        store.focusSession(id);
        navigateBoard(navigate, viewPath, serverId);
      } : undefined,
      onCloseAll: () => {
        useSessionBoardStore.getState().clearBoard();
        navigateBoard(navigate, viewPath, serverId);
      },
    };
  }
  const selected = focusedId && openIds.includes(focusedId) ? focusedId : openIds[0];
  return { views, tabs, mobileSessionId: selected ? viewIdFor(selected) : undefined };
}
