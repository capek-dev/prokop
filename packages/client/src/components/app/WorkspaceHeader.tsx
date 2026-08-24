import { useMemo } from 'react';
import { FolderOpen, PanelLeft } from 'lucide-react';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSidebar } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { useSessionCommands } from '@/contexts/SessionCommandsContext';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { getWorkspacePreconfigs } from '@/lib/workspacePreconfigs';

export function WorkspaceHeader() {
  const showFilesPanel = useChatLayoutStore((s) => s.showFilesPanel);
  const setShowFilesPanel = useChatLayoutStore((s) => s.setShowFilesPanel);
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);
  const allPreconfigs = useServerDataStore(s => s.preconfigs);
  const models = useServerDataStore(s => s.models);
  const defaultModel = useServerDataStore(s => s.defaultModel);
  const allWorkspaces = useServerDataStore(s => s.workspaces);
  const { toggleSidebar, state: sidebarState } = useSidebar();
  const sessionManager = useSessionCommands();

  const focusedSessionId = useSessionBoardStore(s => s.focusedSessionId);
  const openSessionIds = useSessionBoardStore(s => s.openSessionIds);
  const displayedSessionId = focusedSessionId ?? openSessionIds[0] ?? null;
  const allSessions = useSessionStore(s => s.sessions);
  const currentSession = useMemo(
    () => displayedSessionId ? allSessions.find(s => s.id === displayedSessionId) ?? null : null,
    [displayedSessionId, allSessions],
  );

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

  const usageBySessionId = useSessionStore(s => s.usageBySessionId);
  const modelBySessionId = useSessionStore(s => s.modelBySessionId);
  const variantBySessionId = useSessionStore(s => s.variantBySessionId);
  const sessionUsage = (currentSession ? usageBySessionId[currentSession.id] : undefined) ?? {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    noCacheTokens: 0,
  };
  const currentModel = currentSession ? modelBySessionId[currentSession.id] ?? '' : '';
  const selectedVariant = currentSession ? variantBySessionId[currentSession.id] ?? null : null;
  const currentSessionMessages = useSessionStore((s) =>
    currentSession ? s.messagesBySession[currentSession.id] : undefined,
  );
  const streamingSessionIds = useConnectionStore((s) => s.streamingSessionIds);
  const compactableMessageCount = useMemo(
    () => currentSessionMessages?.filter((message) => message.role !== 'system').length ?? 0,
    [currentSessionMessages],
  );

  const isCompacting = currentSession?.compacting ?? false;

  const currentModelInfo = models.find((m) => m.id === currentModel);

  const hasSession = !!currentSession;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-10 flex items-stretch shrink-0 border-b border-border bg-card">
        {/* Left: Sidebar toggle section */}
        <div className={`flex items-center px-1 shrink-0 ${sidebarState === 'expanded' ? 'bg-muted' : ''}`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
              >
                <PanelLeft className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{sidebarState === 'expanded' ? 'Hide Sessions' : 'Show Sessions'}</TooltipContent>
          </Tooltip>
        </div>

        <div className="w-px bg-border shrink-0" />

        {/* Center: Merged ChatHeader content — fills space even when empty */}
        <div className="flex-1 flex items-center min-w-0 px-2">

          {hasSession && currentSession && (
            <ChatHeader
              session={currentSession}
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
              isStreaming={streamingSessionIds.has(currentSession.id) || !!currentSession.runningAt}
              onCompact={compactableMessageCount >= 2 ? () => sessionManager.compactSession(currentSession.id) : undefined}
              isCompacting={isCompacting}
              canCompact={compactableMessageCount >= 2}
              selectedVariant={selectedVariant}
              variants={currentModelInfo?.variants}
              lockPreconfig={lockPreconfig}
            />
          )}
        </div>

        {/* Right: Files / Explorer toggle section */}
        {sessionWorkspace && (
          <>
            <div className="w-px bg-border shrink-0" />
            <div className={`flex items-center px-1 shrink-0 ${showFilesPanel ? 'bg-muted' : ''}`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowFilesPanel(!showFilesPanel)}
                  >
                    <FolderOpen className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{showFilesPanel ? 'Hide Files' : 'Show Files'}</TooltipContent>
              </Tooltip>
            </div>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
