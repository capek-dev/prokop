import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { WorkspaceDock } from '@/components/app/WorkspaceDock';
import { WorkspaceSplitTree } from '@/components/app/WorkspaceSplitTree';
import { filterTree, treeGroups, type ViewTree } from '@/stores/workspaceSplitLayout';
import { WorkspaceTabStrip, workspaceTabLabel } from '@/components/app/WorkspaceTabStrip';
import { WorkspaceTabSearch } from '@/components/app/WorkspaceTabSearch';
import type { WorkspaceTab } from '@/components/app/workspaceTab';
import { WorkspaceViewHost } from '@/components/app/WorkspaceViewHost';
import { DockRegion } from '@/components/layout/DockRegion';
import { Button } from '@/components/ui/button';
import { useIsCompact, useIsMobile } from '@/hooks/use-mobile';
import { useSessionChatLayoutStore as useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useDockStore } from '@/stores/dockStore';
import {
  activeGroupView, findViewGroup, findViewRegion, isFileViewId, isSessionViewId, REPOSITORY_VIEW_IDS, resolveViewLayout, useWorkspaceViewStore,
  type ViewRegion, type WorkspaceViewId,
} from '@/stores/workspaceViewStore';

interface WorkspaceViewsProps {
  views: Partial<Record<WorkspaceViewId, ReactNode>>;
  tabs?: Partial<Record<WorkspaceViewId, WorkspaceTab>>;
  mobileEditorId?: WorkspaceViewId;
  mobileSessionId?: WorkspaceViewId;
}

export function WorkspaceViews({ views, tabs = {}, mobileEditorId, mobileSessionId }: WorkspaceViewsProps) {
  const isMobile = useIsMobile();
  const isCompact = useIsCompact();
  const storedLayout = useWorkspaceViewStore((state) => state.layout);
  const mobileTerminalOpen = useWorkspaceViewStore((state) => state.mobileTerminalOpen);
  const docks = useDockStore((state) => state.docks);
  const setDockOpen = useDockStore((state) => state.setDockOpen);
  const mobileSurface = useChatLayoutStore((state) => state.mobileSurface);
  const setMobileSurface = useChatLayoutStore((state) => state.setMobileSurface);
  const repositoryTab = useChatLayoutStore((state) => state.filesPanelTab);
  const setRepositoryTab = useChatLayoutStore((state) => state.setFilesPanelTab);
  const [centerSlot, attachCenter] = useState<HTMLDivElement | null>(null);
  const [slots, setSlots] = useState<Record<string, HTMLDivElement | null>>({});
  const attachSlot = useCallback((id: string, slot: HTMLDivElement | null) => {
    setSlots((previous) => {
      if ((previous[id] ?? null) === slot) return previous;
      const next = { ...previous };
      if (slot) next[id] = slot;
      else delete next[id];
      return next;
    });
  }, []);
  const available = (Object.keys(views) as WorkspaceViewId[]).filter((id) => views[id] != null);
  const layout = resolveViewLayout(storedLayout, available);
  const fileIds = available.filter(isFileViewId);
  const sessionIds = available.filter(isSessionViewId);
  const selectedSession = mobileSessionId && available.includes(mobileSessionId) ? mobileSessionId : sessionIds[0];
  const hasEditor = fileIds.length > 0 || available.includes('editor');
  const selectedFile = mobileEditorId && fileIds.includes(mobileEditorId as `file:${string}`) ? mobileEditorId : fileIds[0];
  const selectFile = (id: WorkspaceViewId) => {
    useWorkspaceViewStore.getState().activateView(id);
    tabs[id]?.onActivate?.();
  };
  const repositoryIds = REPOSITORY_VIEW_IDS.filter((id) => available.includes(id));
  const repositoryView = repositoryTab === 'project' ? 'explorer' : repositoryTab;
  const chatView = selectedSession ?? 'conversations';
  const requestedMobileView = mobileSurface === 'chat' ? chatView : mobileSurface === 'files' ? repositoryView : mobileSurface;
  const mobileView = requestedMobileView === 'editor' && hasEditor ? 'editor' : available.includes(requestedMobileView) ? requestedMobileView
    : (requestedMobileView === 'editor' || mobileSurface === 'files') && available.includes('explorer') ? 'explorer' : chatView;
  const isRepositoryView = repositoryIds.some((id) => id === mobileView);

  const group = (region: ViewRegion) => {
    const tree: ViewTree = filterTree(layout.roots[region], (id) => !!activeGroupView(layout, id, available))
      ?? { kind: 'group', groupId: treeGroups(layout.roots[region])[0] };
    return <WorkspaceSplitTree tree={tree} region={region} available={available} tabs={tabs} onSlot={attachSlot} />;
  };
  // This is a nonmodal overlay. A modal focus/dismiss layer would interpret
  // events from the stable view portals as outside its React subtree.
  const right = isCompact ? (
    <aside
      data-dock-position="right"
      aria-label="Right dock"
      aria-hidden={!docks.right.open}
      inert={!docks.right.open}
      className="absolute inset-y-0 right-0 z-30 flex w-[min(90vw,720px)] flex-col overflow-hidden border-l bg-sidebar shadow-xl"
      style={{ visibility: docks.right.open ? 'visible' : 'hidden' }}
    >
      <div className="flex shrink-0 justify-end border-b border-border/40 px-1">
        <Button variant="ghost" size="icon-xs" aria-label="Close right dock" onClick={() => setDockOpen('right', false)}><X className="size-3.5" /></Button>
      </div>
      {group('right')}
    </aside>
  ) : <DockRegion position="right">{group('right')}</DockRegion>;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {isMobile ? (
        <div data-mobile-tab-group className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {mobileView !== chatView && (
            <div className="flex h-9 shrink-0 items-center gap-1 bg-sidebar px-1">
              <Button variant="ghost" size="icon-sm" aria-label="Back to Chat" onClick={() => setMobileSurface('chat')}><ArrowLeft className="size-4" /></Button>
              <span className="text-sm">{workspaceTabLabel(mobileView, tabs)}</span>
              {(isRepositoryView || mobileView === 'editor') && hasEditor && (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setMobileSurface(isRepositoryView ? 'editor' : 'files')}>
                  {isRepositoryView ? 'Editor' : 'Files'}
                </Button>
              )}
            </div>
          )}
          {mobileView === chatView && sessionIds.length > 0 && (
            <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/40 px-1">
              <WorkspaceTabStrip ids={sessionIds} activeId={selectedSession ?? null} tabs={tabs} label="Open sessions"
                onSelect={selectFile} onClose={(id) => tabs[id]?.onClose?.()} />
              <WorkspaceTabSearch ids={sessionIds} tabs={tabs} onSelect={selectFile} />
            </div>
          )}
          {isRepositoryView && (
            <div className="flex h-11 shrink-0 items-center border-b border-border/40 px-1">
              <WorkspaceTabStrip ids={repositoryIds} activeId={mobileView} tabs={tabs} label="Repository views"
                onSelect={(id) => {
                  const view = REPOSITORY_VIEW_IDS.find((candidate) => candidate === id);
                  if (view) setRepositoryTab(view === 'explorer' ? 'project' : view);
                }} onClose={() => {}} />
            </div>
          )}
          {mobileView === 'editor' && fileIds.length > 0 && (
            <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/40 px-1">
              <WorkspaceTabStrip ids={fileIds} activeId={selectedFile ?? null} tabs={tabs} label="Open files"
                onSelect={selectFile} onClose={(id) => {
                  if (tabs[id]?.closeDisabled) return;
                  if (tabs[id]?.dirty) selectFile(id);
                  tabs[id]?.onClose?.();
                }} />
              <WorkspaceTabSearch ids={fileIds} tabs={tabs} onSelect={selectFile} />
            </div>
          )}
          <div ref={attachCenter} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            {mobileView === chatView && !selectedSession && !available.includes('conversations') && <WorkspaceEmptyState />}
          </div>
        </div>
      ) : (
        <WorkspaceDock
          left={<DockRegion position="left">{group('left')}</DockRegion>}
          center={<div data-dock-position="center" className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border/50">{group('center')}</div>}
          right={right}
          bottom={<DockRegion position="bottom">{group('bottom')}</DockRegion>}
        />
      )}
      {available.map((id) => {
        const region = findViewRegion(layout, id);
        const groupId = findViewGroup(layout, id);
        const visible = isMobile
          ? id === 'terminals' ? mobileTerminalOpen : isFileViewId(id) ? mobileView === 'editor' && id === selectedFile : id === mobileView
          : activeGroupView(layout, groupId, available) === id && (region === 'center' || docks[region].open);
        return (
          <WorkspaceViewHost key={id} id={id} label={workspaceTabLabel(id, tabs)} target={isMobile ? centerSlot : slots[groupId] ?? null} visible={visible}>
            {views[id]}
          </WorkspaceViewHost>
        );
      })}
    </div>
  );
}

export function WorkspaceEmptyState() {
  return <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
    <p>Select or create a session</p>
    <p className="text-sm">Choose a session from Sessions, or add a view to this dock.</p>
  </div>;
}
