import { Suspense, lazy } from 'react';
import { useParams } from '@tanstack/react-router';
import { useShallow } from 'zustand/react/shallow';
import type { ProkopaiClient, WorkspaceSettings, PermissionGrant } from '@prokopai/sdk';
import { useUIStore } from '@/stores/uiStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useFileEditorStore } from '@/stores/fileEditorStore';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';

const ConfigurationDialog = lazy(() =>
  import('@/components/modals/ConfigurationDialog').then((m) => ({ default: m.ConfigurationDialog })),
);
const WorkspaceSettingsDialog = lazy(() =>
  import('@/components/modals/WorkspaceSettingsDialog').then((m) => ({ default: m.WorkspaceSettingsDialog })),
);
const SchedulerJobModal = lazy(() =>
  import('@/components/modals/SchedulerJobModal').then((m) => ({ default: m.SchedulerJobModal })),
);
const FilePreviewOverlay = lazy(() =>
  import('@/components/files/FilePreviewOverlay'),
);

interface ServerDialogsProps {
  apiToken: string | null;
  isConnected: boolean;
  sdkClient: ProkopaiClient | null;
  onLogout: () => void;
  onConfigurationClose: () => void;
  permissions: PermissionGrant[];
  onRefreshPermissions: () => void;
  onRevokePermission: (permissionId: string) => void;
  onRevokeAllPermissions: (workspaceId: string) => void;
  onUpdateWorkspacePaths: (workspaceId: string, additionalPaths: string[]) => void;
  onUpdateWorkspaceSettings: (workspaceId: string, settings: WorkspaceSettings) => void;
  isUpdatingWorkspace?: Record<string, boolean>;
}

function DialogLoadingFallback() {
  return null;
}

export function ServerDialogs({
  apiToken,
  isConnected,
  sdkClient,
  onLogout,
  onConfigurationClose,
  permissions,
  onRefreshPermissions,
  onRevokePermission,
  onRevokeAllPermissions,
  onUpdateWorkspacePaths,
  onUpdateWorkspaceSettings,
  isUpdatingWorkspace = {},
}: ServerDialogsProps) {
  const params = useParams({
    from: '/server/$serverId',
    strict: false,
  } as unknown as Parameters<typeof useParams>[0]);
  const serverId = params?.serverId as string | undefined;
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);

  const {
    showConfiguration,
    setShowConfiguration,
    showWorkspaceSettings,
    setShowWorkspaceSettings,
    showSchedulerJob,
    editingSchedulerJob,
    setShowSchedulerJob,
  } = useUIStore(
    useShallow((s) => ({
      showConfiguration: s.showConfiguration,
      setShowConfiguration: s.setShowConfiguration,
      showWorkspaceSettings: s.showWorkspaceSettings,
      setShowWorkspaceSettings: s.setShowWorkspaceSettings,
      showSchedulerJob: s.showSchedulerJob,
      editingSchedulerJob: s.editingSchedulerJob,
      setShowSchedulerJob: s.setShowSchedulerJob,
    })),
  );

  const { filePreviewTarget, closeFilePreview } = useUIStore(
    useShallow((s) => ({
      filePreviewTarget: s.filePreviewTarget,
      closeFilePreview: s.closeFilePreview,
    })),
  );

  return (
    <>
      {(showConfiguration || showWorkspaceSettings || showSchedulerJob || filePreviewTarget !== null) && (
        <Suspense fallback={<DialogLoadingFallback />}>
          {showConfiguration && (
            <ConfigurationDialog
              open={showConfiguration}
              onOpenChange={(open) => {
                setShowConfiguration(open);
                if (!open) {
                  onConfigurationClose();
                }
              }}
              sdkClient={sdkClient}
              apiToken={apiToken}
              isConnected={isConnected}
              onLogout={onLogout}
            />
          )}

          {activeWorkspace && showWorkspaceSettings && (
            <WorkspaceSettingsDialog
              open={showWorkspaceSettings}
              onOpenChange={setShowWorkspaceSettings}
              workspace={activeWorkspace}
              onSave={onUpdateWorkspaceSettings}
              sdkClient={sdkClient}
              permissions={permissions}
              onRefreshPermissions={onRefreshPermissions}
              onRevokePermission={onRevokePermission}
              onRevokeAllPermissions={() => onRevokeAllPermissions(activeWorkspace.id)}
              onUpdateWorkspacePaths={onUpdateWorkspacePaths}
              isSaving={!!isUpdatingWorkspace[activeWorkspace.id]}
            />
          )}

          {showSchedulerJob && (
            <SchedulerJobModal
              open={showSchedulerJob}
              onOpenChange={(open) => setShowSchedulerJob(open)}
              sdkClient={sdkClient}
              workspaceId={activeWorkspace?.id ?? null}
              editingJob={editingSchedulerJob}
            />
          )}

          {filePreviewTarget !== null && (
            <FilePreviewOverlay
              workspaceId={filePreviewTarget.workspaceId}
              target={filePreviewTarget}
              sdkClient={sdkClient}
              open={filePreviewTarget !== null}
              onOpenChange={(open) => {
                if (!open) closeFilePreview();
              }}
              onOpenEdit={serverId ? () => {
                useFileEditorStore.getState().openDoc(
                  {
                    serverId,
                    workspaceId: filePreviewTarget.workspaceId,
                    root: filePreviewTarget.root ?? '',
                    path: filePreviewTarget.path,
                  },
                  filePreviewTarget.name,
                );
                const layout = useChatLayoutStore.getState();
                if (window.innerWidth < 640) {
                  layout.setMobileSurface('editor');
                } else {
                  layout.setWorkbenchSurface('editor');
                  layout.setShowFilesPanel(true);
                }
                closeFilePreview();
              } : undefined}
            />
          )}
        </Suspense>
      )}
    </>
  );
}
