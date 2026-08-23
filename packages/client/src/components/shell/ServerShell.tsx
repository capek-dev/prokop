import { useMemo, useRef, useState, useEffect } from 'react';
import { useParams, useRouter, Outlet } from '@tanstack/react-router';
import { useShallow } from 'zustand/react/shallow';

import { useServerContext } from '@/contexts/ServerContext';
import { ViewRefsContext } from '@/contexts/ViewRefsContext';
import { SessionManagerContext } from '@/contexts/SessionManagerContext';
import { ServerClientProvider, useServerClientMemo } from '@/contexts/ServerClientContext';
import { SessionCommandsProvider, type SessionCommandsValue } from '@/contexts/SessionCommandsContext';
import {
  SessionPaneRegistryContext,
  type SessionPaneHandle,
  type SessionPaneRegistry,
} from '@/contexts/SessionPaneRegistryContext';
import { useServerSessionManager } from '@/hooks/useServerSessionManager';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { platform } from '@/platform';
import { SidebarProvider } from '@/components/ui/sidebar';

import { AppHeader } from '@/components/app/AppHeader';
import { AppKeyboardHandlersMount } from '@/hooks/useAppKeyboardHandlers';
import { FilesPanel, type FilesPanelHandle } from '@/components/layout/FilesPanel';
import type { MessageInputHandle } from '@/components/chat/MessageInput';
import type { TerminalPanelHandle } from '@/components/layout/TerminalPanel';
import type { AppSidebarHandle } from '@/components/layout/AppSidebar';
import { ServerDialogs } from './ServerDialogs';

export default function ServerShell() {
  const router = useRouter();
  const params = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
  const serverId = params.serverId;

  const {
    servers,
    removeFromQuickConnectionsByWorkspace,
    quickConnections,
  } = useServerContext();

  const activeServer = servers.find(s => s.id === serverId) ?? null;

  const sessionManager = useServerSessionManager({
    serverId,
    activeServer,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    navigate: (opts: { to: string; params?: Record<string, string>; search?: Record<string, unknown> }) => router.navigate({ to: opts.to as any, params: opts.params as any, search: opts.search as any }),
    removeFromQuickConnectionsByWorkspace,
    quickConnections,
  });

  const chatInputRef = useRef<MessageInputHandle>(null);
  const terminalPanelRef = useRef<TerminalPanelHandle>(null);
  const filesPanelRef = useRef<FilesPanelHandle>(null);
  const sidebarRef = useRef<AppSidebarHandle>(null);
  const scrollToBottomRef = useRef<(() => void) | null>(null);
  const autoFollowToggleRef = useRef<{ toggle: () => void } | null>(null);
  const [paneHandles] = useState<Map<string, SessionPaneHandle>>(() => new Map());
  const paneRegistry = useMemo<SessionPaneRegistry>(() => ({
    panes: paneHandles,
    register: (sessionId, handle) => { paneHandles.set(sessionId, handle); },
    unregister: (sessionId) => { paneHandles.delete(sessionId); },
    getHandle: (sessionId) => paneHandles.get(sessionId),
  }), [paneHandles]);

  const {
    showFilesPanel,
    filesPanelWidth,
    sessionsPanelWidth,
  } = useChatLayoutStore(useShallow((s) => ({
    showFilesPanel: s.showFilesPanel,
    filesPanelWidth: s.filesPanelWidth,
    sessionsPanelWidth: s.sessionsPanelWidth,
  })));

  const viewRefs = useMemo(() => ({
    sidebarRef,
    chatInputRef,
    terminalPanelRef,
    filesPanelRef,
    scrollToBottomRef,
    autoFollowToggleRef,
  }), []);

  const serverClientValue = useServerClientMemo(
    sessionManager.sdkClient,
    sessionManager.serverUrl,
    sessionManager.apiToken,
    sessionManager.connected,
  );

  // Commands context holds action functions only. The manager object and its
  // functions get new identities on every store change; delegating through a ref
  // keeps the context value stable so command consumers (SessionPane, headers,
  // inputs) never re-render from reactive session state changes.
  const sessionManagerRef = useRef(sessionManager);
  useEffect(() => {
    sessionManagerRef.current = sessionManager;
  });
  const commandsValue = useMemo(() => {
    const manager = () => sessionManagerRef.current;
    return {
      createSession: (...args: Parameters<SessionCommandsValue['createSession']>) => manager().createSession(...args),
      resumeSession: (...args: Parameters<SessionCommandsValue['resumeSession']>) => manager().resumeSession(...args),
      openAlongside: (...args: Parameters<SessionCommandsValue['openAlongside']>) => manager().openAlongside(...args),
      closeSession: (...args: Parameters<SessionCommandsValue['closeSession']>) => manager().closeSession(...args),
      reopenSession: (...args: Parameters<SessionCommandsValue['reopenSession']>) => manager().reopenSession(...args),
      permanentlyDeleteSession: (...args: Parameters<SessionCommandsValue['permanentlyDeleteSession']>) => manager().permanentlyDeleteSession(...args),
      handleRenameSession: (...args: Parameters<SessionCommandsValue['handleRenameSession']>) => manager().handleRenameSession(...args),
      regenerateSessionTitle: (...args: Parameters<SessionCommandsValue['regenerateSessionTitle']>) => manager().regenerateSessionTitle(...args),
      revertSession: (...args: Parameters<SessionCommandsValue['revertSession']>) => manager().revertSession(...args),
      forkSession: (...args: Parameters<SessionCommandsValue['forkSession']>) => manager().forkSession(...args),
      editMessage: (...args: Parameters<SessionCommandsValue['editMessage']>) => manager().editMessage(...args),
      compactSession: (...args: Parameters<SessionCommandsValue['compactSession']>) => manager().compactSession(...args),
      removeFromQueue: (...args: Parameters<SessionCommandsValue['removeFromQueue']>) => manager().removeFromQueue(...args),
      sendChatMessage: (...args: Parameters<SessionCommandsValue['sendChatMessage']>) => manager().sendChatMessage(...args),
      sendChatMessageForSession: (...args: Parameters<SessionCommandsValue['sendChatMessageForSession']>) => manager().sendChatMessageForSession(...args),
      handleAskResponse: (...args: Parameters<SessionCommandsValue['handleAskResponse']>) => manager().handleAskResponse(...args),
      handleInterruptSession: (...args: Parameters<SessionCommandsValue['handleInterruptSession']>) => manager().handleInterruptSession(...args),
      handleInterruptSessionById: (...args: Parameters<SessionCommandsValue['handleInterruptSessionById']>) => manager().handleInterruptSessionById(...args),
      updateSessionPreconfig: (...args: Parameters<SessionCommandsValue['updateSessionPreconfig']>) => manager().updateSessionPreconfig(...args),
      updateSessionPreconfigForSession: (...args: Parameters<SessionCommandsValue['updateSessionPreconfigForSession']>) => manager().updateSessionPreconfigForSession(...args),
      updateSessionModel: (...args: Parameters<SessionCommandsValue['updateSessionModel']>) => manager().updateSessionModel(...args),
      updateSessionModelForSession: (...args: Parameters<SessionCommandsValue['updateSessionModelForSession']>) => manager().updateSessionModelForSession(...args),
      updateSessionVariant: (...args: Parameters<SessionCommandsValue['updateSessionVariant']>) => manager().updateSessionVariant(...args),
      updateSessionVariantForSession: (...args: Parameters<SessionCommandsValue['updateSessionVariantForSession']>) => manager().updateSessionVariantForSession(...args),
      handleNavigateBack: () => manager().handleNavigateBack(),
      selectWorkspace: (...args: Parameters<SessionCommandsValue['selectWorkspace']>) => manager().selectWorkspace(...args),
      renameWorkspace: (...args: Parameters<SessionCommandsValue['renameWorkspace']>) => manager().renameWorkspace(...args),
      updateWorkspacePaths: (...args: Parameters<SessionCommandsValue['updateWorkspacePaths']>) => manager().updateWorkspacePaths(...args),
      updateWorkspaceSettings: (...args: Parameters<SessionCommandsValue['updateWorkspaceSettings']>) => manager().updateWorkspaceSettings(...args),
      handleCreateVirtualWorkspace: () => manager().handleCreateVirtualWorkspace(),
      handleCreatePhysicalWorkspace: (...args: Parameters<SessionCommandsValue['handleCreatePhysicalWorkspace']>) => manager().handleCreatePhysicalWorkspace(...args),
      deleteWorkspace: (...args: Parameters<SessionCommandsValue['deleteWorkspace']>) => manager().deleteWorkspace(...args),
      createSessionInWorkspace: (...args: Parameters<SessionCommandsValue['createSessionInWorkspace']>) => manager().createSessionInWorkspace(...args),
      claimControl: (...args: Parameters<SessionCommandsValue['claimControl']>) => manager().claimControl(...args),
      handleLogout: () => manager().handleLogout(),
      handleRetry: () => manager().handleRetry(),
      refreshPermissions: () => manager().refreshPermissions(),
      revokePermission: (...args: Parameters<SessionCommandsValue['revokePermission']>) => manager().revokePermission(...args),
      revokeAllPermissions: (...args: Parameters<SessionCommandsValue['revokeAllPermissions']>) => manager().revokeAllPermissions(...args),
    } satisfies SessionCommandsValue;
  }, []);

  return (
    <SessionPaneRegistryContext.Provider value={paneRegistry}>
      <ServerClientProvider value={serverClientValue}>
        <SidebarProvider panelId="sessions" defaultOpen={true} className="flex-col" style={{ '--sidebar-width': `${sessionsPanelWidth}px`, '--header-height': platform.id === 'electron' ? '4.625rem' : '2.75rem' } as React.CSSProperties}>
          <div className="bg-background">
            <AppHeader />
          </div>

          <div className="flex flex-1 min-h-0">
            <SessionManagerContext.Provider value={sessionManager}>
              <SessionCommandsProvider value={commandsValue}>
                <ViewRefsContext.Provider value={viewRefs}>
                  <Outlet />
                </ViewRefsContext.Provider>
              </SessionCommandsProvider>
            </SessionManagerContext.Provider>

            <FilesPanel
              ref={filesPanelRef}
              sdkClient={sessionManager.sdkClient}
            />

            <div
              data-panel-gap="files"
              className={`relative bg-transparent transition-[width] duration-200 ease-linear shrink-0 ${!showFilesPanel ? 'w-0' : ''}`}
              style={{ width: showFilesPanel ? filesPanelWidth : 0 }}
            />
          </div>

          <AppKeyboardHandlersMount
            sidebarRef={sidebarRef}
            terminalPanelRef={terminalPanelRef}
            filesPanelRef={filesPanelRef}
            chatInputRef={chatInputRef}
            handleInterruptSession={sessionManager.handleInterruptSession}
            serverId={serverId}
            createSession={sessionManager.createSession}
            onToggleAutoFollow={() => autoFollowToggleRef.current?.toggle()}
          />

          <ServerDialogs
            apiToken={sessionManager.apiToken}
            isConnected={sessionManager.connected}
            sdkClient={sessionManager.sdkClient}
            onLogout={sessionManager.handleLogout}
            onConfigurationClose={() => router.invalidate()}
            permissions={sessionManager.permissions}
            onRefreshPermissions={sessionManager.refreshPermissions}
            onRevokePermission={sessionManager.revokePermission}
            onRevokeAllPermissions={sessionManager.revokeAllPermissions}
            onUpdateWorkspacePaths={sessionManager.updateWorkspacePaths}
            onUpdateWorkspaceSettings={sessionManager.updateWorkspaceSettings}
            isUpdatingWorkspace={sessionManager.isUpdatingWorkspace}
          />
        </SidebarProvider>
      </ServerClientProvider>
    </SessionPaneRegistryContext.Provider>
  );
}
