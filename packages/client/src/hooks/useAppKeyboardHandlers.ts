import {useCallback, useLayoutEffect, useRef} from 'react';
import {useRouter} from '@tanstack/react-router';
import {useSidebar} from '@/components/ui/sidebar';
import {useKeyboardShortcuts} from '@/hooks/useKeyboardShortcuts';
import {useChatLayoutStore} from '@/stores/chatLayoutStore';
import {useServerDataStore} from '@/stores/serverDataStore';
import type {AppSidebarHandle} from '@/components/layout/AppSidebar';
import type {Preconfig, Workspace} from '@prokopai/sdk';
import { getWorkspaceDefaultPreconfigId } from '@/lib/workspacePreconfigs';
import { useBoardFocus } from '@/hooks/useBoardFocus';
import { useSessionPaneRegistry } from '@/contexts/SessionPaneRegistryContext';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';

export interface AppKeyboardHandlersConfig {
  sidebarRef: React.RefObject<AppSidebarHandle | null>;
  terminalPanelRef: React.RefObject<{ focus: () => void } | null>;
  filesPanelRef: React.RefObject<{ focus: () => void } | null>;
  chatInputRef: React.RefObject<{ focus: () => void } | null>;
  activeWorkspace: Workspace | null;
  primaryPreconfigs: Preconfig[];
  handleInterruptSession: () => void;
  serverId: string;
  createSession: (preconfigId?: string, title?: string) => void;
  setSidebarOpen: (open: boolean) => void;
  onToggleAutoFollow?: () => void;
}

export function useAppKeyboardHandlers({
  sidebarRef,
  terminalPanelRef,
  filesPanelRef,
  chatInputRef,
  activeWorkspace,
  primaryPreconfigs,
  handleInterruptSession,
  serverId,
  createSession,
  setSidebarOpen,
  onToggleAutoFollow,
}: AppKeyboardHandlersConfig) {
  const paneRegistry = useSessionPaneRegistry();
  const focusBoard = useBoardFocus();

  const focusSidebarSessionPanel = useCallback(() => {
    if (window.innerWidth < 640) {
      useChatLayoutStore.getState().setMobileSurface('sessions');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const surface = document.querySelector<HTMLElement>(
            '[data-mobile-surface="sessions"]',
          );
          const firstSession = surface?.querySelector<HTMLElement>(
            '[data-sidebar="menu-button"]',
          );
          (firstSession ?? surface)?.focus();
        });
      });
      return;
    }

    setSidebarOpen(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sidebarRef.current?.focusSessionPanel();
      });
    });
  }, [setSidebarOpen, sidebarRef]);

  const focusTerminalPanel = useCallback(() => {
    useChatLayoutStore.getState().setShowTerminalPanel(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        terminalPanelRef.current?.focus();
      });
    });
  }, [terminalPanelRef]);

  const focusSidebarSessionPanelRef = useRef(focusSidebarSessionPanel);
  useLayoutEffect(() => {
    focusSidebarSessionPanelRef.current = focusSidebarSessionPanel;
  });

  const focusTerminalPanelRef = useRef(focusTerminalPanel);
  useLayoutEffect(() => {
    focusTerminalPanelRef.current = focusTerminalPanel;
  });

  const handleCloseTerminal = useCallback(() => {
    useChatLayoutStore.getState().setShowTerminalPanel(false);
  }, []);

  const focusFilesPanel = useCallback(() => {
    requestAnimationFrame(() => {
      filesPanelRef.current?.focus();
    });
  }, [filesPanelRef]);

  const focusFilesPanelRef = useRef(focusFilesPanel);
  useLayoutEffect(() => {
    focusFilesPanelRef.current = focusFilesPanel;
  });

  const focusChatInput = useCallback(() => {
    const focusedSessionId = useSessionBoardStore.getState().focusedSessionId;
    const focusedPane = focusedSessionId
      ? paneRegistry.getHandle(focusedSessionId)
      : undefined;

    if (focusedPane) {
      focusedPane.focusInput();
      return;
    }

    chatInputRef.current?.focus();
  }, [chatInputRef, paneRegistry]);

  const handleNewSession = useCallback(() => {
    if (activeWorkspace) {
      const defaultId = getWorkspaceDefaultPreconfigId(activeWorkspace, primaryPreconfigs);
      if (defaultId) createSession(defaultId);
    }
  }, [activeWorkspace, primaryPreconfigs, createSession]);

  const router = useRouter();

  const handleToggleViewMode = useCallback(() => {
    const currentPath = router.state.location.pathname;
    if (currentPath.includes('/overview')) {
      router.navigate({ to: '/server/$serverId/workspace', params: { serverId } });
    } else {
      router.navigate({ to: '/server/$serverId/overview', params: { serverId } });
    }
  }, [router, serverId]);

  const handleCloseFocusedPanel = useCallback(() => {
    const activeEl = document.activeElement;
    if (activeEl?.closest('[data-mobile-surface="sessions"]')) {
      useChatLayoutStore.getState().setMobileSurface('chat');
    } else if (activeEl?.closest('[data-terminal-panel]')) {
      handleCloseTerminal();
    } else if (activeEl?.closest('[data-panel-id="files"]')) {
      useChatLayoutStore.getState().setShowFilesPanel(false);
    } else if (activeEl?.closest('[data-editor-surface]')) {
      const layout = useChatLayoutStore.getState();
      if (window.innerWidth < 640) layout.setMobileSurface('files');
      else layout.setShowFilesPanel(false);
    } else if (activeEl?.closest('[data-workbench-explorer]')) {
      const layout = useChatLayoutStore.getState();
      if (window.innerWidth < 640) layout.setMobileSurface('chat');
      else layout.setShowFilesPanel(false);
    } else if (activeEl?.closest('[data-sidebar="sidebar"]')) {
      setSidebarOpen(false);
    }
  }, [handleCloseTerminal, setSidebarOpen]);

  const handleStopStreaming = useCallback(() => {
    handleInterruptSession();
  }, [handleInterruptSession]);

  const focusPaneInput = useCallback((sessionId: string) => {
    const state = useSessionBoardStore.getState();
    if (sessionId !== state.focusedSessionId) {
      focusBoard(sessionId);
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        paneRegistry.getHandle(sessionId)?.focusInput();
      });
    });
  }, [focusBoard, paneRegistry]);

  const handleFocusPane = useCallback((index: number) => {
    const sessionId = useSessionBoardStore.getState().openSessionIds[index];
    if (sessionId) focusPaneInput(sessionId);
  }, [focusPaneInput]);

  const handleCyclePane = useCallback((direction: -1 | 1) => {
    const state = useSessionBoardStore.getState();
    if (state.openSessionIds.length < 2) return;

    const currentIndex = state.focusedSessionId
      ? state.openSessionIds.indexOf(state.focusedSessionId)
      : 0;
    const normalizedIndex = currentIndex === -1 ? 0 : currentIndex;
    const targetIndex = (
      normalizedIndex + direction + state.openSessionIds.length
    ) % state.openSessionIds.length;
    const sessionId = state.openSessionIds[targetIndex];
    if (sessionId) focusPaneInput(sessionId);
  }, [focusPaneInput]);

  const handleToggleAutoFollow = useCallback(() => {
    const focusedSessionId = useSessionBoardStore.getState().focusedSessionId;
    const focusedPane = focusedSessionId
      ? paneRegistry.getHandle(focusedSessionId)
      : undefined;

    if (focusedPane) {
      focusedPane.toggleAutoFollow();
      return;
    }

    onToggleAutoFollow?.();
  }, [onToggleAutoFollow, paneRegistry]);

  useKeyboardShortcuts({
    onOpenSidebar: () => focusSidebarSessionPanelRef.current(),
    onOpenTerminal: () => focusTerminalPanelRef.current(),
    onOpenFilesPanel: () => focusFilesPanelRef.current(),
    onNewSession: handleNewSession,
    onToggleViewMode: handleToggleViewMode,
    onCloseFocusedPanel: handleCloseFocusedPanel,
    onFocusChatInput: focusChatInput,
    onStopStreaming: handleStopStreaming,
    onToggleAutoFollow: handleToggleAutoFollow,
    onFocusPane: handleFocusPane,
    onCyclePane: handleCyclePane,
  });
}

export interface AppKeyboardHandlersMountProps {
  sidebarRef: React.RefObject<AppSidebarHandle | null>;
  terminalPanelRef: React.RefObject<{ focus: () => void } | null>;
  filesPanelRef: React.RefObject<{ focus: () => void } | null>;
  chatInputRef: React.RefObject<{ focus: () => void } | null>;
  handleInterruptSession: () => void;
  serverId: string;
  createSession: (preconfigId?: string, title?: string) => void;
  onToggleAutoFollow?: () => void;
}

export function AppKeyboardHandlersMount(props: AppKeyboardHandlersMountProps) {
  const { setOpen } = useSidebar();
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);
  const preconfigs = useServerDataStore((s) => s.preconfigs);
  const primaryPreconfigs = preconfigs.filter((p) => p.mode !== 'subagent');

  useAppKeyboardHandlers({ ...props, activeWorkspace, primaryPreconfigs, setSidebarOpen: setOpen });

  return null;
}
