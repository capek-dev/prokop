import { Suspense, lazy } from 'react';
import { useWorkspaceViewVisible } from '@/components/app/WorkspaceViewHost';
import { useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useDockStore } from '@/stores/dockStore';
import { DockRegion } from '@/components/layout/DockRegion';
import { useIsMobile } from '@/hooks/use-mobile';
import { useServerDataStore } from '@/stores/serverDataStore';
import { KeepAliveStack } from '@/components/app/KeepAliveStack';
import type { TerminalPanelHandle } from '@/components/layout/TerminalPanel';
import type { ProkopaiClient } from '@prokopai/sdk';

const EMPTY_PATHS: string[] = [];

const TerminalPanel = lazy(() =>
  import('@/components/layout/TerminalPanel').then((m) => ({ default: m.TerminalPanel })),
);

interface AppPanelsProps {
  embedded?: boolean;
  sdkClient: ProkopaiClient | null;
  terminalPanelRef: React.RefObject<TerminalPanelHandle | null>;
}

function TerminalLoadingFallback() {
  return (
    <div className="animate-appear-late flex items-center justify-center h-full min-h-[200px] text-muted-foreground">
      <div className="h-6 w-6 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
    </div>
  );
}

export function AppPanels({
  sdkClient,
  terminalPanelRef,
  embedded = false,
}: AppPanelsProps) {
  const visible = useWorkspaceViewVisible();
  const isMobile = useIsMobile();
  const bottomOpen = useDockStore((s) => s.docks.bottom.open);
  const setDockOpen = useDockStore((s) => s.setDockOpen);
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);

  const open = embedded ? visible : bottomOpen;
  const onClose = () => {
    if (!embedded) setDockOpen('bottom', false);
    else if (isMobile) useWorkspaceViewStore.getState().setMobileTerminalOpen(false);
    else useWorkspaceViewStore.getState().hideView('terminals');
  };

  // One panel per recent workspace: switching back reuses its xterm
  // instances and PTY connections instead of recreating them. Hidden panels
  // stay connected only if they were started while active, and in the bottom
  // dock only while it is open.
  const terminal = (
    <Suspense fallback={<TerminalLoadingFallback />}>
      <KeepAliveStack
        active={{ key: activeWorkspace?.id ?? '', value: activeWorkspace }}
      >
        {(workspace, active) => (
          <TerminalPanel
            ref={active ? terminalPanelRef : undefined}
            workspaceId={workspace?.id}
            workspacePath={workspace?.path}
            workspaceName={workspace?.name}
            additionalPaths={workspace?.additionalPaths ?? EMPTY_PATHS}
            sdkClient={sdkClient}
            isOpen={open && active}
            keepAlive={embedded || (!active && open)}
            onClose={onClose}
          />
        )}
      </KeepAliveStack>
    </Suspense>
  );

  if (embedded) return terminal;
  return <DockRegion position="bottom" overlay={isMobile}>{terminal}</DockRegion>;
}
