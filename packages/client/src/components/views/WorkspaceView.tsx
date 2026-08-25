import { useCallback, useMemo } from 'react';
import { Plus } from 'lucide-react';
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
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { getWorkspaceDefaultPreconfigId } from '@/lib/workspacePreconfigs';
import { getCreateSessionOptions } from '@/lib/sessionCreate';
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/components/ui/sidebar';

export interface WorkspaceViewProps {
  /** Optional override for the sidebar header switcher. Defaults to WorkspaceSwitcher. */
  switcher?: React.ReactNode;
  /** Optional override for the default preconfig used by the New Chat button. */
  defaultPreconfigId?: string;
}

export default function WorkspaceView({ switcher, defaultPreconfigId }: WorkspaceViewProps = {}) {
  const sessionManager = useSessionManager();
  const sidebarData = useSidebarData();
  const { sidebarRef, chatInputRef, terminalPanelRef } = useViewRefs();
  const activeWorkspace = useServerDataStore(s => s.activeWorkspace);
  const allPreconfigs = useServerDataStore(s => s.preconfigs);

  const openSessionIds = useSessionBoardStore(s => s.openSessionIds);
  const hasMultipleOpenSessions = openSessionIds.length > 1;

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

  const newChatPreconfigId = defaultPreconfigId
    ?? getWorkspaceDefaultPreconfigId(activeWorkspace, allPreconfigs)
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
      {switcher ?? (
        <WorkspaceSwitcher
          workspaces={sidebarData.workspaces}
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
      )}
      <div className="px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={(event) => createSession(
                newChatPreconfigId,
                undefined,
                getCreateSessionOptions(event),
              )}
              disabled={!sidebarData.connected}
              className="w-full"
            >
              <Plus className="size-4" data-icon="inline-start" />
              <span>New Chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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
      onResumeSession={resumeSession}
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

  return (
    <>
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
        {sidebarContent}
        {sidebarData.activeWorkspace && (
          <PinnedMessagesPanel
            sdkClient={sdkClient}
            workspaceId={sidebarData.activeWorkspace.id}
            currentSessionId={sidebarData.currentSessionId}
            onNavigateToPinnedMessage={(sessionId, messageId) => {
              resumeSession(sessionId, { targetMessageId: messageId });
            }}
          />
        )}
      </AppSidebar>

      <main
        className="flex-1 flex flex-col overflow-hidden min-h-0 p-2"
        style={{ paddingTop: '0.5rem', paddingBottom: '0.5rem' }}
      >
        <div className="flex flex-1 flex-col overflow-hidden min-h-0 rounded-xl bg-background shadow-sm ring-1 ring-border">
          {hasMultipleOpenSessions ? <WorkspaceBoardToolbar /> : <WorkspaceHeader />}
          <WorkspaceContentArea
            sdkClient={sdkClient}
            serverUrl={sessionManager.serverUrl}
          />
          <AppPanels
            sdkClient={sdkClient}
            terminalPanelRef={terminalPanelRef}
          />
        </div>
      </main>
    </>
  );
}