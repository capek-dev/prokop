import { Suspense, lazy } from 'react';
import { useWorkspaceViewVisible } from '@/components/app/WorkspaceViewHost';
import { useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useDockStore } from '@/stores/dockStore';
import { DockRegion } from '@/components/layout/DockRegion';
import { useIsMobile } from '@/hooks/use-mobile';
import { useServerDataStore } from '@/stores/serverDataStore';
import type { TerminalPanelHandle } from '@/components/layout/TerminalPanel';
import type { ProkopaiClient } from '@prokopai/sdk';

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
    <div className="flex items-center justify-center h-full min-h-[200px] text-muted-foreground">
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

  const workspaceId = activeWorkspace?.id;
  const workspacePath = activeWorkspace?.path;
  const workspaceName = activeWorkspace?.name;

  const terminal = (
    <Suspense fallback={<TerminalLoadingFallback />}>
      <TerminalPanel
        ref={terminalPanelRef}
        workspaceId={workspaceId}
        workspacePath={workspacePath}
        workspaceName={workspaceName}
        additionalPaths={activeWorkspace?.additionalPaths ?? []}
        sdkClient={sdkClient}
        isOpen={embedded ? visible : bottomOpen}
        keepAlive={embedded}
        onClose={() => {
          if (!embedded) setDockOpen('bottom', false);
          else if (isMobile) useWorkspaceViewStore.getState().setMobileTerminalOpen(false);
          else useWorkspaceViewStore.getState().hideView('terminals');
        }}
      />
    </Suspense>
  );

  if (embedded) return terminal;
  return <DockRegion position="bottom" overlay={isMobile}>{terminal}</DockRegion>;
}
