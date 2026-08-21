import { Suspense, lazy } from 'react';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { platform } from '@/platform';
import type { TerminalPanelHandle } from '@/components/layout/TerminalPanel';
import type { ProkopaiClient } from '@prokopai/sdk';

const TerminalPanel = lazy(() =>
  import('@/components/layout/TerminalPanel').then((m) => ({ default: m.TerminalPanel })),
);

interface AppPanelsProps {
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
}: AppPanelsProps) {
  const showTerminalPanel = useChatLayoutStore((s) => s.showTerminalPanel);
  const setShowTerminalPanel = useChatLayoutStore((s) => s.setShowTerminalPanel);
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);

  const workspaceId = activeWorkspace?.id;
  const workspacePath = activeWorkspace?.path;
  const workspaceName = activeWorkspace?.name;

  if (platform.capabilities.terminal) {
    return null;
  }

  return (
    <Suspense fallback={<TerminalLoadingFallback />}>
      <TerminalPanel
        ref={terminalPanelRef}
        workspaceId={workspaceId}
        workspacePath={workspacePath}
        workspaceName={workspaceName}
        sdkClient={sdkClient}
        isOpen={showTerminalPanel}
        onOpen={() => setShowTerminalPanel(true)}
        onClose={() => setShowTerminalPanel(false)}
      />
    </Suspense>
  );
}
