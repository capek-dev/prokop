import { useMemo } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { useSessionCommands } from '@/contexts/SessionCommandsContext';
import { useServerClient } from '@/contexts/ServerClientContext';
import { useSessionStore, type SessionUsage } from '@/stores/sessionStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { getWorkspacePreconfigs } from '@/lib/workspacePreconfigs';
import { getWorkspaceDisplayName } from '@/lib/workspaceKind';
import { useRouterState } from '@tanstack/react-router';
import { useScopedServerData } from '@/contexts/HostScopeContext';

const EMPTY_USAGE: SessionUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  noCacheTokens: 0,
};

/**
 * Slim per-session header inside the primary card. Shell-level panel toggles
 * live in the global AppHeader title bar.
 */
export function WorkspaceHeader({ sessionId }: { sessionId?: string } = {}) {
  const activeWorkspace = useScopedServerData(s => s.activeWorkspace);
  const allPreconfigs = useScopedServerData(s => s.preconfigs);
  const models = useScopedServerData(s => s.models);
  const defaultModel = useScopedServerData(s => s.defaultModel);
  const allWorkspaces = useScopedServerData(s => s.workspaces);
  const sessionManager = useSessionCommands();
  // Scoped client: the pane may show a session from another machine.
  const { sdkClient, serverUrl } = useServerClient();

  const focusedSessionId = useSessionBoardStore(s => s.focusedSessionId);
  const openSessionIds = useSessionBoardStore(s => s.openSessionIds);
  const displayedSessionId = sessionId ?? focusedSessionId ?? openSessionIds[0] ?? null;
  // Per-session selectors: other sessions' updates must not re-render this header.
  const currentSession = useSessionStore(s => displayedSessionId ? s.sessions.find(x => x.id === displayedSessionId) ?? null : null);

  // Resolve the workspace from the displayed session's workspaceId,
  // not from the global activeWorkspace which may not have synced yet.
  const sessionWorkspace = useMemo(() => {
    if (currentSession?.workspaceId) {
      const resolved = allWorkspaces.find(w => w.id === currentSession.workspaceId);
      if (resolved) return resolved;
    }
    return activeWorkspace;
  }, [currentSession?.workspaceId, allWorkspaces, activeWorkspace]);

  const preconfigs = getWorkspacePreconfigs(sessionWorkspace, allPreconfigs);
  const lockPreconfig = !!sessionWorkspace?.settings?.isAgentHome;
  // Overview mixes sessions from every workspace; name the one this pane belongs to.
  const inOverview = useRouterState({ select: (s) => s.location.pathname.includes('/overview') });
  const agents = useScopedServerData(s => s.agents);
  const workspaceLabel = inOverview && sessionWorkspace ? getWorkspaceDisplayName(sessionWorkspace, agents) : null;

  // Until the resume reply fills the per-session maps, show what the session
  // record already carries, so the header renders complete in the first frame.
  const storedUsage = useSessionStore(s => (displayedSessionId ? s.usageBySessionId[displayedSessionId] : undefined));
  const storedModel = useSessionStore(s => (displayedSessionId ? s.modelBySessionId[displayedSessionId] : undefined));
  const storedVariant = useSessionStore(s => (displayedSessionId ? s.variantBySessionId[displayedSessionId] : undefined));
  const sessionUsage = storedUsage ?? (currentSession?.totalTokens ? {
    promptTokens: currentSession.promptTokens ?? 0,
    completionTokens: currentSession.completionTokens ?? 0,
    totalTokens: currentSession.totalTokens,
    cacheReadTokens: currentSession.cacheReadTokens ?? 0,
    cacheWriteTokens: currentSession.cacheWriteTokens ?? 0,
    noCacheTokens: currentSession.noCacheTokens ?? 0,
  } : EMPTY_USAGE);
  const currentModel = storedModel ?? currentSession?.selectedModel ?? '';
  const selectedVariant = storedVariant !== undefined ? storedVariant : currentSession?.selectedVariant ?? null;
  const currentSessionMessages = useSessionStore((s) =>
    currentSession ? s.messagesBySession[currentSession.id] : undefined,
  );
  const isSessionStreaming = useConnectionStore((s) => displayedSessionId ? s.streamingSessionIds.has(displayedSessionId) : false);
  const compactableMessageCount = useMemo(
    () => currentSessionMessages?.filter((message) => message.role !== 'system').length ?? 0,
    [currentSessionMessages],
  );

  const isCompacting = currentSession?.compacting ?? false;

  const currentModelInfo = models.find((m) => m.id === currentModel);

  const hasSession = !!currentSession;

  return (
    <TooltipProvider>
      <div
        data-slot="primary-dock-header"
        className="flex h-10 shrink-0 items-stretch"
      >
        <div className="flex min-w-0 flex-1 items-center px-2">
          {hasSession && currentSession && (
            <ChatHeader
              session={currentSession}
              sdkClient={sdkClient}
              serverUrl={serverUrl}
              preconfigs={preconfigs}
              models={models}
              defaultModel={defaultModel}
              usage={sessionUsage}
              modelName={currentModel}
              onChangePreconfig={(preconfigId) => sessionManager.updateSessionPreconfigForSession(currentSession.id, preconfigId)}
              onChangeModel={(modelId, providerId) => sessionManager.updateSessionModelForSession(currentSession.id, modelId, providerId)}
              onChangeVariant={(variant) => sessionManager.updateSessionVariantForSession(currentSession.id, variant)}
              onRename={sessionManager.handleRenameSession}
              onNavigateBack={
                currentSession.parentId
                  ? () => sessionManager.resumeSession(currentSession.parentId!)
                  : undefined
              }
              isStreaming={isSessionStreaming || !!currentSession.runningAt}
              onCompact={compactableMessageCount >= 2 ? () => sessionManager.compactSession(currentSession.id) : undefined}
              isCompacting={isCompacting}
              canCompact={compactableMessageCount >= 2}
              selectedVariant={selectedVariant}
              variants={currentModelInfo?.variants}
              lockPreconfig={lockPreconfig}
              workspaceLabel={workspaceLabel}
            />
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
