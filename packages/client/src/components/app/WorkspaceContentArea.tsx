import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useWorkspaceSessionTabs } from '@/hooks/useWorkspaceSessionTabs';
import { FileEditorSurface, type FileEditorSurfaceHandle } from '@/components/editor/FileEditorSurface';
import { WorkspaceViews } from '@/components/app/WorkspaceViews';
import { WorkspaceUsageView } from '@/components/app/WorkspaceUsageView';
import { FilesPanel } from '@/components/layout/FilesPanel';
import { WorktreesPanel } from '@/components/worktrees/WorktreesPanel';
import { useViewRefs } from '@/contexts/ViewRefsContext';
import { useServerDataStore } from '@/stores/serverDataStore';
import { isDocDirty, useFileEditorStore } from '@/stores/fileEditorStore';
import { fileViewId, type WorkspaceViewId } from '@/stores/workspaceViewStore';
import type { WorkspaceTab } from '@/components/app/workspaceTab';
import { getWorkspaceDisplayName } from '@/lib/workspaceKind';

interface WorkspaceContentAreaProps {
  sdkClient: ProkopaiClient | null;
  serverUrl: string | null;
  sessionsContent?: ReactNode;
  sessionsHeader?: ReactNode;
  left?: ReactNode;
  bottom?: ReactNode;
}

/** Resource content stays mounted while the workspace changes its placement. */
export function WorkspaceContentArea({
  sdkClient, serverUrl, sessionsContent, sessionsHeader, left, bottom,
}: WorkspaceContentAreaProps) {
  const params = useParams({
    from: '/server/$serverId', strict: false,
  } as unknown as Parameters<typeof useParams>[0]);
  const serverId = params?.serverId as string | undefined;
  const activeWorkspace = useServerDataStore((state) => state.activeWorkspace);
  const workspaceId = activeWorkspace?.id;
  const workspaces = useServerDataStore((state) => state.workspaces);
  const agents = useServerDataStore((state) => state.agents);
  const sessionTabs = useWorkspaceSessionTabs(serverId, sdkClient, serverUrl);
  const { filesPanelRef } = useViewRefs();
  const anyDirty = useFileEditorStore((state) => state.anyDirty);
  const docs = useFileEditorStore((state) => state.docs);
  const openDocIds = useFileEditorStore((state) => state.openDocIds);
  const activeDocId = useFileEditorStore((state) => state.activeDocId);
  const editorHandles = useRef(new Map<string, FileEditorSurfaceHandle>());
  const scopedDocIds = openDocIds.filter((id) => {
    const identity = docs[id]?.identity;
    return identity?.serverId === serverId;
  });
  const nameCounts = new Map<string, number>();
  for (const id of scopedDocIds) nameCounts.set(docs[id].name, (nameCounts.get(docs[id].name) ?? 0) + 1);
  const resourceViews: Partial<Record<WorkspaceViewId, ReactNode>> = { ...sessionTabs.views };
  const tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>> = { ...sessionTabs.tabs };
  for (const docId of scopedDocIds) {
    const doc = docs[docId];
    const viewId = fileViewId(docId);
    const workspace = workspaces.find((item) => item.id === doc.identity.workspaceId)
      ?? (activeWorkspace?.id === doc.identity.workspaceId ? activeWorkspace : undefined);
    const projectName = (workspace ? getWorkspaceDisplayName(workspace, agents) : undefined) || 'Unknown project';
    const checkout = doc.identity.root || workspace?.path || 'Main checkout';
    const context = `${projectName} · ${checkout} · ${doc.identity.path}`;
    resourceViews[viewId] = (
      <FileEditorSurface
        ref={(handle) => {
          if (handle) editorHandles.current.set(docId, handle);
          else editorHandles.current.delete(docId);
        }}
        sdkClient={sdkClient} serverId={doc.identity.serverId}
        workspaceId={doc.identity.workspaceId} documentId={docId} documentContext={context}
      />
    );
    tabs[viewId] = {
      label: (nameCounts.get(doc.name) ?? 0) > 1 ? `${doc.name} · ${context}` : doc.name,
      description: context,
      dirty: isDocDirty(doc),
      closeDisabled: doc.status === 'saving',
      onActivate: () => useFileEditorStore.getState().setActiveDoc(docId),
      onClose: () => editorHandles.current.get(docId)?.requestClose(),
    };
  }
  const mobileEditorId = activeDocId && scopedDocIds.includes(activeDocId)
    ? fileViewId(activeDocId) : scopedDocIds[0] ? fileViewId(scopedDocIds[0]) : undefined;

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!anyDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [anyDirty]);

  return (
    <WorkspaceViews tabs={tabs} mobileEditorId={mobileEditorId} mobileSessionId={sessionTabs.mobileSessionId} views={{
      ...resourceViews,
      sessions: left ?? (sessionsContent ? <>{sessionsHeader}{sessionsContent}</> : undefined),
      usage: <WorkspaceUsageView sdkClient={sdkClient} />,
      explorer: serverId && workspaceId ? <FilesPanel ref={filesPanelRef} sdkClient={sdkClient} view="explorer" embedded /> : undefined,
      changes: serverId && workspaceId ? <FilesPanel sdkClient={sdkClient} view="changes" embedded /> : undefined,
      branches: serverId && workspaceId ? <FilesPanel sdkClient={sdkClient} view="branches" embedded /> : undefined,
      worktrees: serverId && workspaceId ? <WorktreesPanel sdkClient={sdkClient} workspaceId={workspaceId} /> : undefined,
      terminals: bottom,
    }} />
  );
}
