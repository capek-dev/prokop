import { useCallback, useMemo } from 'react';
import { useViewRefs } from '@/contexts/ViewRefsContext';
import { useSessionManager } from '@/contexts/SessionManagerContext';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { WorkspaceHeader } from '@/components/app/WorkspaceHeader';
import { AppPanels } from '@/components/app/AppPanels';
import { useSidebarData } from '@/hooks/useSidebarData';
import { useOverviewSessions } from '@/hooks/useOverviewSessions';
import { useOverviewGroups } from '@/hooks/useOverviewGroups';
import { useInvalidateWorkspaceTags } from '@/hooks/queries';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useMobileSessionSelection } from '@/hooks/useMobileSessionSelection';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useBoardRouteSync } from '@/hooks/useBoardRouteSync';
import { useFocusedSessionWorkspaceContext } from '@/hooks/useFocusedSessionWorkspaceContext';
import { useOverviewRouteSessionLoader } from '@/hooks/useOverviewRouteSessionLoader';
import { WorkspaceOverview } from '@/components/layout/WorkspaceOverview';
import { WorkspaceContentArea } from '@/components/app/WorkspaceContentArea';
import { WorkspaceDock } from '@/components/app/WorkspaceDock';

export default function OverviewView() {
  const sessionManager = useSessionManager();
  const sidebarData = useSidebarData();
  const { sidebarRef, chatInputRef, terminalPanelRef } = useViewRefs();
  const updateSession = useSessionStore(s => s.updateSession);
  const invalidateWorkspaceTags = useInvalidateWorkspaceTags();
  const agents = useServerDataStore(state => state.agents);

  const activeServer = sidebarData.activeServer;

  const overviewGroups = useOverviewGroups(
    activeServer?.id,
    sidebarData.workspaces,
  );

  // Use active group workspace IDs for the overview query.
  // When not hydrated yet, use empty array to avoid briefly fetching stars.
  const overviewWorkspaceIds = useMemo(
    () =>
      overviewGroups.isHydrated
        ? overviewGroups.activeWorkspaceIds
        : [],
    [overviewGroups.isHydrated, overviewGroups.activeWorkspaceIds],
  );

  const openSessionIds = useSessionBoardStore(s => s.openSessionIds);
  const layoutMode = useSessionBoardStore(s => s.layoutMode);
  const showBoardToolbar = openSessionIds.length > 1 && layoutMode === 'board';

  // Overview scope: sessions from any accessible workspace are valid.
  useBoardRouteSync({ scope: { kind: 'overview' } });

  // Synchronize focused session's workspace to shared workspace context.
  useFocusedSessionWorkspaceContext();

  // Fetch unknown route session IDs directly (F5 restoration).
  useOverviewRouteSessionLoader(sessionManager.sdkClient, sidebarData.connected);

  const {
    sessionsByWorkspace,
    tagGroupsByWorkspace,
    orderedTagNamesByWorkspace,
    allWorkspaceTagsByWorkspace,
    hasMoreByWorkspace,
    fetchNextPageForWorkspace,
    loadingMoreWorkspace,
  } = useOverviewSessions({
    sdkClient: sessionManager.sdkClient,
    workspaceIds: overviewWorkspaceIds,
    connected: sidebarData.connected,
  });

  const {
    sdkClient,
    resumeSession,
    openAlongside,
    closeSession,
    reopenSession,
    permanentlyDeleteSession,
    handleRenameSession,
    regenerateSessionTitle,
    createSessionInWorkspace,
  } = sessionManager;
  const handleResumeSession = useMobileSessionSelection(resumeSession);

  const handleAddTag = useCallback(async (sessionId: string, tag: string) => {
    if (!sdkClient) return;
    const newTags = [tag];
    const { session } = await sdkClient.http.sessions.update(sessionId, { tags: newTags });
    updateSession(session);
    invalidateWorkspaceTags(session.workspaceId);
  }, [sdkClient, updateSession, invalidateWorkspaceTags]);

  const handleRemoveTag = useCallback(async (sessionId: string, _tag: string) => {
    if (!sdkClient) return;
    const { session } = await sdkClient.http.sessions.update(sessionId, { tags: [] });
    updateSession(session);
    invalidateWorkspaceTags(session.workspaceId);
  }, [sdkClient, updateSession, invalidateWorkspaceTags]);

  const sidebarContent = (
    <WorkspaceOverview
      sessionsByWorkspace={sessionsByWorkspace}
      tagGroupsByWorkspace={tagGroupsByWorkspace}
      orderedTagNamesByWorkspace={orderedTagNamesByWorkspace}
      allWorkspaceTagsByWorkspace={allWorkspaceTagsByWorkspace}
      childrenMap={sidebarData.childrenMap}
      sessionDerivedValues={sidebarData.sessionDerivedValues}
      currentSession={sidebarData.currentSession}
      currentSessionId={sidebarData.currentSessionId}
      workspaceIds={overviewWorkspaceIds}
      workspaces={sidebarData.workspaces}
      agents={agents}
      activeWorkspace={sidebarData.activeWorkspace}
      isHydrated={overviewGroups.isHydrated}
      groups={overviewGroups.groups}
      activeGroup={overviewGroups.activeGroup}
      groupActions={overviewGroups.actions}
      serverId={activeServer?.id ?? ''}
      onResumeSession={handleResumeSession}
      onOpenAlongside={openAlongside}
      onCloseSession={closeSession}
      onReopenSession={reopenSession}
      onDeleteSession={permanentlyDeleteSession}
      onRenameSession={handleRenameSession}
      onRegenerateSessionTitle={regenerateSessionTitle}
      onCreateSessionInWorkspace={createSessionInWorkspace}
      onAddTag={handleAddTag}
      onRemoveTag={handleRemoveTag}
      connected={sidebarData.connected}
      hasMoreByWorkspace={hasMoreByWorkspace}
      loadingMoreWorkspace={loadingMoreWorkspace}
      onLoadMoreWorkspace={fetchNextPageForWorkspace}
    />
  );

  return (
    <WorkspaceDock
      sessions={(
        <AppSidebar
          ref={sidebarRef}
          currentSessionId={sidebarData.currentSessionId}
          onEscape={() => {
            if (sidebarData.currentSessionId) {
              chatInputRef.current?.focus();
            }
          }}
        >
          {sidebarContent}
        </AppSidebar>
      )}
      content={(
        <WorkspaceContentArea
          primaryHeader={showBoardToolbar ? null : <WorkspaceHeader />}
          sdkClient={sessionManager.sdkClient}
          serverUrl={sessionManager.serverUrl}
          sessionsContent={sidebarContent}
        />
      )}
      panels={(
        <AppPanels
          sdkClient={sessionManager.sdkClient}
          terminalPanelRef={terminalPanelRef}
        />
      )}
    />
  );
}
