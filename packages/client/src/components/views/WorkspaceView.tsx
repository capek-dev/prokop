import { useCallback, useMemo } from 'react';
import { SquarePen } from 'lucide-react';
import { toast } from 'sonner';
import { useViewRefs } from '@/contexts/ViewRefsContext';
import { useSessionManager } from '@/contexts/SessionManagerContext';
import { useSidebarData } from '@/hooks/useSidebarData';
import { useWorkspaceSessions } from '@/hooks/useWorkspaceSessions';
import { useWorkspaceTagsQuery, useInvalidateWorkspaceTags } from '@/hooks/queries';
import { useScheduledJobs, usePauseScheduledJob, useResumeScheduledJob, useTriggerScheduledJob, useDeleteScheduledJob } from '@/hooks/queries';
import { useSessionStore } from '@/stores/sessionStore';
import { useBoardRouteSync } from '@/hooks/useBoardRouteSync';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useUIStore } from '@/stores/uiStore';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { WorkspaceBoardToolbar } from '@/components/app/WorkspaceBoardToolbar';
import { WorkspaceHeader } from '@/components/app/WorkspaceHeader';
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher';
import { WorkspaceSessionContent } from '@/components/layout/WorkspaceSessionContent';
import { PinnedMessagesPanel } from '@/components/layout/PinnedMessagesPanel';
import { AppPanels } from '@/components/app/AppPanels';
import { WorkspaceContentArea } from '@/components/app/WorkspaceContentArea';
import { WorkspaceDock } from '@/components/app/WorkspaceDock';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useMobileSessionSelection } from '@/hooks/useMobileSessionSelection';
import { getWorkspaceDefaultPreconfigId } from '@/lib/workspacePreconfigs';
import { getCreateSessionOptions } from '@/lib/sessionCreate';
import { SidebarHeader } from '@/components/ui/sidebar';

export default function WorkspaceView() {
  const sessionManager = useSessionManager();
  const sidebarData = useSidebarData();
  const { sidebarRef, chatInputRef, terminalPanelRef } = useViewRefs();
  const activeWorkspace = useServerDataStore(s => s.activeWorkspace);
  const agents = useServerDataStore(s => s.agents);
  const allPreconfigs = useServerDataStore(s => s.preconfigs);

  const openSessionIds = useSessionBoardStore(s => s.openSessionIds);
  const layoutMode = useSessionBoardStore(s => s.layoutMode);
  const showBoardToolbar = openSessionIds.length > 1 && layoutMode === 'board';

  // Sync board state with URL search params
  useBoardRouteSync({ scope: { kind: 'workspace', workspaceId: activeWorkspace?.id ?? null } });

  const {
    sdkClient,
    primaryPreconfigs,
    createSession,
    resumeSession,
    openAlongside,
    closeSession,
    reopenSession,
    permanentlyDeleteSession,
    handleRenameSession,
    regenerateSessionTitle,
    selectWorkspace,
    handleCreateVirtualWorkspace,
    handleCreatePhysicalWorkspace,
    deleteWorkspace,
    renameWorkspace,
    updateWorkspacePaths,
    isCreatingWorkspace,
    deletingWorkspaceId,
    isUpdatingWorkspace,
  } = sessionManager;
  const handleResumeSession = useMobileSessionSelection(resumeSession);

  const newChatPreconfigId = getWorkspaceDefaultPreconfigId(activeWorkspace, allPreconfigs)
    ?? primaryPreconfigs[0]?.id;

  const {
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useWorkspaceSessions({
    sdkClient,
    workspaceId: sidebarData.activeWorkspace?.id ?? null,
    connected: sidebarData.connected,
  });

  // Read from store via useSidebarData — WebSocket events update the store
  const activeSessions = sidebarData.activeSessions;
  const archivedSessions = sidebarData.archivedSessions;

  // Tags
  const { data: tagsData } = useWorkspaceTagsQuery(sdkClient, sidebarData.activeWorkspace?.id ?? null);
  const allWorkspaceTags = tagsData?.tags ?? [];
  const invalidateWorkspaceTags = useInvalidateWorkspaceTags();

  // Scheduled jobs
  const workspaceIdForJobs = sidebarData.activeWorkspace?.id ?? null;
  const { data: scheduledJobs } = useScheduledJobs(sdkClient, workspaceIdForJobs);
  const pauseJobMutation = usePauseScheduledJob(sdkClient, workspaceIdForJobs);
  const resumeJobMutation = useResumeScheduledJob(sdkClient, workspaceIdForJobs);
  const triggerJobMutation = useTriggerScheduledJob(sdkClient, workspaceIdForJobs);
  const deleteJobMutation = useDeleteScheduledJob(sdkClient, workspaceIdForJobs);
  const pendingScheduledJobIds = useMemo(() => new Set([
    pauseJobMutation.isPending ? pauseJobMutation.variables : undefined,
    resumeJobMutation.isPending ? resumeJobMutation.variables : undefined,
    triggerJobMutation.isPending ? triggerJobMutation.variables : undefined,
    deleteJobMutation.isPending ? deleteJobMutation.variables : undefined,
  ].filter((jobId): jobId is string => typeof jobId === 'string')), [
    pauseJobMutation.isPending,
    pauseJobMutation.variables,
    resumeJobMutation.isPending,
    resumeJobMutation.variables,
    triggerJobMutation.isPending,
    triggerJobMutation.variables,
    deleteJobMutation.isPending,
    deleteJobMutation.variables,
  ]);

  const setShowSchedulerJob = useUIStore(s => s.setShowSchedulerJob);

  const updateSession = useSessionStore(s => s.updateSession);

  const handleAddTag = useCallback(async (sessionId: string, tag: string) => {
    if (!sdkClient) return;
    const newTags = [tag];
    const { session } = await sdkClient.http.sessions.update(sessionId, { tags: newTags });
    updateSession(session);
    if (sidebarData.activeWorkspace?.id) {
      invalidateWorkspaceTags(sidebarData.activeWorkspace.id);
    }
  }, [sdkClient, sidebarData.activeWorkspace?.id, invalidateWorkspaceTags, updateSession]);

  const handleRemoveTag = useCallback(async (sessionId: string, _tag: string) => {
    if (!sdkClient) return;
    const { session } = await sdkClient.http.sessions.update(sessionId, { tags: [] });
    updateSession(session);
    if (sidebarData.activeWorkspace?.id) {
      invalidateWorkspaceTags(sidebarData.activeWorkspace.id);
    }
  }, [sdkClient, sidebarData.activeWorkspace?.id, invalidateWorkspaceTags, updateSession]);

  const sidebarHeader = (
    <SidebarHeader className="p-1">
      <div className="flex min-w-0 items-center gap-1">
        <WorkspaceSwitcher
          workspaces={sidebarData.workspaces}
          agents={agents}
          activeWorkspace={sidebarData.activeWorkspace}
          onSelectWorkspace={selectWorkspace}
          onCreateVirtualWorkspace={handleCreateVirtualWorkspace}
          onCreatePhysicalWorkspace={handleCreatePhysicalWorkspace}
          onDeleteWorkspace={deleteWorkspace}
          onRenameWorkspace={renameWorkspace}
          onUpdateWorkspacePaths={updateWorkspacePaths}
          sdkClient={sdkClient}
          isCreatingWorkspace={isCreatingWorkspace}
          deletingWorkspaceId={deletingWorkspaceId}
          isUpdatingWorkspace={isUpdatingWorkspace}
        />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(event) => createSession(
                  newChatPreconfigId,
                  undefined,
                  getCreateSessionOptions(event),
                )}
                disabled={!sidebarData.connected}
                className="ml-auto shrink-0"
                aria-label="New Chat"
              >
                <SquarePen className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Chat</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </SidebarHeader>
  );

  const handleBulkCloseSessions = useCallback((sessionIds: Set<string>) => {
    sessionIds.forEach(id => closeSession(id));
  }, [closeSession]);

  const handleBulkDeleteSessions = useCallback((sessionIds: Set<string>) => {
    sessionIds.forEach(id => permanentlyDeleteSession(id));
  }, [permanentlyDeleteSession]);

  const sidebarContent = (
    <WorkspaceSessionContent
      activeSessions={activeSessions}
      archivedSessions={archivedSessions}
      scheduledJobs={scheduledJobs ?? []}
      scheduledSessionsByJob={sidebarData.scheduledSessionsByJob}
      pendingScheduledJobIds={pendingScheduledJobIds}
      childrenMap={sidebarData.childrenMap}
      sessionDerivedValues={sidebarData.sessionDerivedValues}
      currentSessionId={sidebarData.currentSessionId}
      onResumeSession={handleResumeSession}
      onOpenAlongside={openAlongside}
      onCloseSession={closeSession}
      onReopenSession={reopenSession}
      onDeleteSession={permanentlyDeleteSession}
      onRenameSession={handleRenameSession}
      onRegenerateSessionTitle={regenerateSessionTitle}
      onBulkCloseSessions={handleBulkCloseSessions}
      onBulkDeleteSessions={handleBulkDeleteSessions}
      tagGroups={sidebarData.tagGroups}
      orderedTagNames={sidebarData.orderedTagNames}
      allWorkspaceTags={allWorkspaceTags}
      onAddTag={handleAddTag}
      onRemoveTag={handleRemoveTag}
      onCreateScheduledJob={() => setShowSchedulerJob(true)}
      onEditScheduledJob={(job) => setShowSchedulerJob(true, job)}
      onPauseScheduledJob={(jobId) => pauseJobMutation.mutate(jobId, {
        onError: (error) => toast.error('Failed to pause scheduled job', { description: error.message }),
      })}
      onResumeScheduledJob={(jobId) => resumeJobMutation.mutate(jobId, {
        onError: (error) => toast.error('Failed to resume scheduled job', { description: error.message }),
      })}
      onTriggerScheduledJob={(jobId) => triggerJobMutation.mutate(jobId, {
        onError: (error) => toast.error('Failed to trigger scheduled job', { description: error.message }),
      })}
      onDeleteScheduledJob={(jobId) => deleteJobMutation.mutate(jobId, {
        onError: (error) => toast.error('Failed to delete scheduled job', { description: error.message }),
      })}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onLoadMore={fetchNextPage}
    />
  );

  const sessionsPanelContent = (
    <>
      {sidebarContent}
      {sidebarData.activeWorkspace && (
        <PinnedMessagesPanel
          sdkClient={sdkClient}
          workspaceId={sidebarData.activeWorkspace.id}
          currentSessionId={sidebarData.currentSessionId}
          onNavigateToPinnedMessage={(sessionId, messageId) => {
            handleResumeSession(sessionId, { targetMessageId: messageId });
          }}
        />
      )}
    </>
  );

  return (
    <WorkspaceDock
      sessions={(
        <AppSidebar
          ref={sidebarRef}
          header={sidebarHeader}
          currentSessionId={sidebarData.currentSessionId}
          onEscape={() => {
            if (sidebarData.currentSessionId) {
              chatInputRef.current?.focus();
            }
          }}
        >
          {sessionsPanelContent}
        </AppSidebar>
      )}
      content={(
        <WorkspaceContentArea
          primaryHeader={showBoardToolbar ? <WorkspaceBoardToolbar /> : <WorkspaceHeader />}
          sdkClient={sdkClient}
          serverUrl={sessionManager.serverUrl}
          sessionsHeader={sidebarHeader}
          sessionsContent={sessionsPanelContent}
        />
      )}
      panels={(
        <AppPanels
          sdkClient={sdkClient}
          terminalPanelRef={terminalPanelRef}
        />
      )}
    />
  );
}