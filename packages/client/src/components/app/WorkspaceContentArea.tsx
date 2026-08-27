import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { SessionBoard } from '@/components/board/SessionBoard';
import { DesktopPanelDivider } from '@/components/layout/DesktopPanelDivider';
import { WorkspaceWorkbench } from '@/components/app/WorkspaceWorkbench';
import { WorkspacePrimarySurface } from '@/components/app/WorkspacePrimarySurface';
import { Button } from '@/components/ui/button';
import { SidebarContent } from '@/components/ui/sidebar';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useViewRefs } from '@/contexts/ViewRefsContext';
import { useIsCompact, useIsMobile } from '@/hooks/use-mobile';
import { usePointerDrag } from '@/hooks/usePointerDrag';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useFileEditorStore, hasOpenDocsForScope } from '@/stores/fileEditorStore';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { cn } from '@/lib/utils';

const WORKBENCH_WIDTH_STORAGE_KEY = 'prokopai_workbench_width_px';
const WORKBENCH_MIN_WIDTH = 360;
const WORKBENCH_MAX_WIDTH = 720;
const SESSION_MIN_WIDTH = 380;
const WORKBENCH_DEFAULT_WIDTH = 540;

function loadWorkbenchWidth(): number {
  if (typeof window === 'undefined') return WORKBENCH_DEFAULT_WIDTH;
  const stored = localStorage.getItem(WORKBENCH_WIDTH_STORAGE_KEY);
  if (stored === null) return WORKBENCH_DEFAULT_WIDTH;
  const parsed = Number(stored);
  if (!Number.isFinite(parsed)) return WORKBENCH_DEFAULT_WIDTH;
  return Math.min(WORKBENCH_MAX_WIDTH, Math.max(WORKBENCH_MIN_WIDTH, parsed));
}

function saveWorkbenchWidth(width: number): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(WORKBENCH_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Ignore persistence errors.
  }
}

interface WorkspaceContentAreaProps {
  sdkClient: ProkopaiClient | null;
  serverUrl: string | null;
  primaryHeader?: ReactNode;
  sessionsContent?: ReactNode;
  sessionsHeader?: ReactNode;
}

/**
 * Composes the session surface and one stable files/editor workbench. Narrow
 * layouts move the workbench into a sheet without changing session board state.
 */
export function WorkspaceContentArea({
  sdkClient,
  serverUrl,
  primaryHeader,
  sessionsContent,
  sessionsHeader,
}: WorkspaceContentAreaProps) {
  const params = useParams({
    from: '/server/$serverId',
    strict: false,
  } as unknown as Parameters<typeof useParams>[0]);
  const serverId = params?.serverId as string | undefined;
  const activeWorkspace = useServerDataStore((state) => state.activeWorkspace);
  const workspaceId = activeWorkspace?.id;
  const isMobile = useIsMobile();
  const isCompact = useIsCompact();
  const { filesPanelRef } = useViewRefs();

  const showWorkbench = useChatLayoutStore((state) => state.showFilesPanel);
  const setShowWorkbench = useChatLayoutStore((state) => state.setShowFilesPanel);
  const mobileSurface = useChatLayoutStore((state) => state.mobileSurface);
  const setMobileSurface = useChatLayoutStore((state) => state.setMobileSurface);
  const anyDirty = useFileEditorStore((state) => state.anyDirty);
  const openDocCount = useFileEditorStore((state) => state.openDocIds.length);
  const hasEditorDocs =
    !!serverId &&
    !!workspaceId &&
    openDocCount > 0 &&
    hasOpenDocsForScope(serverId, workspaceId);

  useEffect(() => {
    if (!isMobile) return;
    if (
      !workspaceId &&
      (mobileSurface === 'files' || mobileSurface === 'editor')
    ) {
      setMobileSurface('chat');
      return;
    }
    if (mobileSurface === 'sessions' && !sessionsContent) {
      setMobileSurface('chat');
      return;
    }
    if (mobileSurface === 'editor' && !hasEditorDocs) {
      setMobileSurface('files');
    }
  }, [hasEditorDocs, isMobile, mobileSurface, sessionsContent, setMobileSurface, workspaceId]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!anyDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [anyDirty]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const workbenchPaneRef = useRef<HTMLDivElement | null>(null);
  const [workbenchWidth, setWorkbenchWidth] = useState(loadWorkbenchWidth);

  const resizeWorkbench = useCallback((event: PointerEvent): number | null => {
    const container = containerRef.current;
    if (!container || !workbenchPaneRef.current) return null;

    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return null;

    const availableMaximum = Math.max(WORKBENCH_MIN_WIDTH, rect.width - SESSION_MIN_WIDTH);
    const maximum = Math.min(WORKBENCH_MAX_WIDTH, availableMaximum);
    const nextWidth = Math.min(
      maximum,
      Math.max(WORKBENCH_MIN_WIDTH, rect.right - event.clientX),
    );
    container.style.setProperty('--workbench-width', `${nextWidth}px`);
    return nextWidth;
  }, []);

  const commitWorkbenchWidth = useCallback((nextWidth: number) => {
    setWorkbenchWidth(nextWidth);
    saveWorkbenchWidth(nextWidth);
  }, []);

  useEffect(() => {
    if (isMobile || isCompact) return;
    const container = containerRef.current;
    if (!container) return;

    let resizeFrame: number | null = null;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const maximum = Math.min(
        WORKBENCH_MAX_WIDTH,
        Math.max(WORKBENCH_MIN_WIDTH, entry.contentRect.width - SESSION_MIN_WIDTH),
      );
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        setWorkbenchWidth((currentWidth) => {
          const nextWidth = Math.min(currentWidth, maximum);
          container.style.setProperty('--workbench-width', `${nextWidth}px`);
          if (nextWidth !== currentWidth) saveWorkbenchWidth(nextWidth);
          return nextWidth;
        });
      });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    };
  }, [isCompact, isMobile]);

  const handleDividerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    const availableMaximum = rect
      ? Math.max(WORKBENCH_MIN_WIDTH, rect.width - SESSION_MIN_WIDTH)
      : WORKBENCH_MAX_WIDTH;
    const maximum = Math.min(WORKBENCH_MAX_WIDTH, availableMaximum);
    const direction = event.key === 'ArrowLeft' ? 1 : -1;
    const nextWidth = Math.min(
      maximum,
      Math.max(WORKBENCH_MIN_WIDTH, workbenchWidth + direction * 16),
    );
    containerRef.current?.style.setProperty('--workbench-width', `${nextWidth}px`);
    commitWorkbenchWidth(nextWidth);
  }, [commitWorkbenchWidth, workbenchWidth]);

  const handleDividerDown = usePointerDrag({
    cursor: 'ew-resize',
    onMove: resizeWorkbench,
    onCommit: commitWorkbenchWidth,
  });

  if (!serverId) {
    return (
      <WorkspacePrimarySurface header={primaryHeader}>
        <SessionBoard sdkClient={sdkClient} serverUrl={serverUrl} />
      </WorkspacePrimarySurface>
    );
  }

  if (isMobile) {
    return (
      <div ref={containerRef} className="relative flex min-h-0 min-w-0 max-w-full flex-1 overflow-hidden">
        <div
          className={cn(
            'relative flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden',
            mobileSurface !== 'chat' && 'invisible pointer-events-none',
          )}
          aria-hidden={mobileSurface !== 'chat'}
          inert={mobileSurface !== 'chat'}
          data-mobile-surface="chat"
        >
          <WorkspacePrimarySurface header={primaryHeader}>
            <SessionBoard sdkClient={sdkClient} serverUrl={serverUrl} />
          </WorkspacePrimarySurface>
        </div>
        {sessionsContent && (
          <div
            className={cn(
              'absolute inset-0 z-10 flex min-h-0 min-w-0 flex-col overflow-hidden bg-card',
              mobileSurface !== 'sessions' && 'invisible pointer-events-none',
            )}
            aria-hidden={mobileSurface !== 'sessions'}
            inert={mobileSurface !== 'sessions'}
            data-mobile-surface="sessions"
            tabIndex={-1}
          >
            <div className="flex shrink-0 items-center gap-1 px-1 py-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back to Chat"
                onClick={() => setMobileSurface('chat')}
              >
                <ArrowLeft className="size-4" />
              </Button>
              <span className="text-sm font-medium">Sessions</span>
            </div>
            {sessionsHeader}
            <SidebarContent className="outline-none">
              {sessionsContent}
            </SidebarContent>
          </div>
        )}
        {workspaceId && (
          <div
            className={cn(
              'absolute inset-0 z-10 flex min-h-0 min-w-0 flex-col overflow-hidden bg-card',
              mobileSurface !== 'files' && mobileSurface !== 'editor' && 'invisible pointer-events-none',
            )}
            aria-hidden={mobileSurface !== 'files' && mobileSurface !== 'editor'}
            inert={mobileSurface !== 'files' && mobileSurface !== 'editor'}
            data-mobile-surface="workbench"
          >
            <WorkspaceWorkbench
              sdkClient={sdkClient}
              serverId={serverId}
              workspaceId={workspaceId}
              width={512}
              filesPanelRef={filesPanelRef}
              onClose={() => setMobileSurface('chat')}
              mobile
            />
          </div>
        )}
      </div>
    );
  }

  if (!workspaceId) {
    return (
      <div ref={containerRef} className="flex min-h-0 min-w-0 max-w-full flex-1 overflow-hidden">
        <WorkspacePrimarySurface header={primaryHeader}>
          <SessionBoard sdkClient={sdkClient} serverUrl={serverUrl} />
        </WorkspacePrimarySurface>
      </div>
    );
  }

  if (isCompact) {
    return (
      <div ref={containerRef} className="flex min-h-0 min-w-0 max-w-full flex-1 overflow-hidden">
        <WorkspacePrimarySurface header={primaryHeader}>
          <SessionBoard sdkClient={sdkClient} serverUrl={serverUrl} />
        </WorkspacePrimarySurface>
        <Sheet open={showWorkbench} onOpenChange={setShowWorkbench}>
          <SheetContent
            forceMount
            side="right"
            className="w-[min(90vw,720px)] max-w-none gap-0 p-0 data-closed:invisible data-closed:pointer-events-none [&>button]:hidden"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Workspace workbench</SheetTitle>
            </SheetHeader>
            <WorkspaceWorkbench
              sdkClient={sdkClient}
              serverId={serverId}
              workspaceId={workspaceId}
              width={workbenchWidth}
              filesPanelRef={filesPanelRef}
              onClose={() => setShowWorkbench(false)}
            />
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 min-w-0 max-w-full flex-1 overflow-hidden"
      style={{ '--workbench-width': `${workbenchWidth}px` } as CSSProperties}
    >
      <WorkspacePrimarySurface header={primaryHeader}>
        <SessionBoard sdkClient={sdkClient} serverUrl={serverUrl} />
      </WorkspacePrimarySurface>
      {showWorkbench && (
        <DesktopPanelDivider
          label="Resize Workbench"
          min={WORKBENCH_MIN_WIDTH}
          max={WORKBENCH_MAX_WIDTH}
          value={workbenchWidth}
          onKeyDown={handleDividerKeyDown}
          onPointerDown={handleDividerDown}
        />
      )}
      <div
        ref={workbenchPaneRef}
        className={cn(
          'min-h-0 min-w-0 shrink-0 overflow-hidden',
          !showWorkbench && 'invisible pointer-events-none',
        )}
        style={{ width: showWorkbench ? 'var(--workbench-width)' : 0 }}
      >
        <WorkspaceWorkbench
          sdkClient={sdkClient}
          serverId={serverId}
          workspaceId={workspaceId}
          width={workbenchWidth}
          filesPanelRef={filesPanelRef}
          onClose={() => setShowWorkbench(false)}
        />
      </div>
    </div>
  );
}
