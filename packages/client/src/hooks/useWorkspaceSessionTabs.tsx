import type { ReactNode } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { ProkopaiClient } from '@prokopai/sdk';
import { WorkspaceSessionView } from '@/components/app/WorkspaceSessionView';
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

export function useWorkspaceSessionTabs(serverId: string | undefined, sdkClient: ProkopaiClient | null, serverUrl: string | null): {
  views: Partial<Record<WorkspaceViewId, ReactNode>>;
  tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>>;
  mobileSessionId?: WorkspaceViewId;
} {
  const openIds = useSessionBoardStore((state) => state.openSessionIds);
  const focusedId = useSessionBoardStore((state) => state.focusedSessionId);
  const sessions = useSessionStore((state) => state.sessions);
  const requests = useAskStore((state) => state.pendingRequests);
  const streamingIds = useConnectionStore((state) => state.streamingSessionIds);
  const connected = useConnectionStore((state) => state.connected);
  const workspaces = useServerDataStore((state) => state.workspaces);
  const agents = useServerDataStore((state) => state.agents);
  const focus = useBoardFocus();
  const navigate = useNavigate();
  const viewPath = useRouterState({ select: (state) => state.location.pathname.includes('/overview') ? '/overview' : '/workspace' });
  useBoardSessionLoader(sdkClient, connected);

  const views: Partial<Record<WorkspaceViewId, ReactNode>> = {};
  const tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>> = {};
  if (!serverId) return { views, tabs };
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
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
    const viewId = sessionViewId(serverId, id);
    const workspaceName = session && workspaceNames.get(session.workspaceId);
    const title = session?.title || 'Untitled session';
    const label = workspaceName ? `${workspaceName} / ${title}` : title;
    const status = needsInputIds.has(id) ? 'Needs input' : runningIds.has(id) ? 'Running' : undefined;
    views[viewId] = <WorkspaceSessionView sessionId={id} sdkClient={sdkClient} serverUrl={serverUrl} />;
    tabs[viewId] = {
      label,
      status,
      onActivate: () => focus(id),
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
  return { views, tabs, mobileSessionId: selected ? sessionViewId(serverId, selected) : undefined };
}
