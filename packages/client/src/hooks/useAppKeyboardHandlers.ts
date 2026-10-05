import {useCallback, useLayoutEffect, useRef} from 'react';
import {useRouter} from '@tanstack/react-router';
import { isFileViewId, isWorkspaceViewId, useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useDockStore, type DockPosition } from '@/stores/dockStore';
import {useKeyboardShortcuts} from '@/hooks/useKeyboardShortcuts';
import {useChatLayoutStore} from '@/stores/chatLayoutStore';
import {useServerDataStore} from '@/stores/serverDataStore';
import type {AppSidebarHandle} from '@/components/layout/AppSidebar';
import type {Preconfig, Workspace} from '@prokopai/sdk';
import { getWorkspaceDefaultPreconfigId } from '@/lib/workspacePreconfigs';
import { useSessionPaneRegistry } from '@/contexts/SessionPaneRegistryContext';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useWorkspaceFocusStore } from '@/stores/workspaceFocusStore';

function focusedWorkspaceGroup(): HTMLElement | undefined {
  const groupId = useWorkspaceFocusStore.getState().groupId;
  return Array.from(document.querySelectorAll<HTMLElement>('[data-view-group]'))
    .find((group) => group.dataset.viewGroup === groupId && !group.closest('[inert], [hidden], [aria-hidden="true"]'));
}

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
  onToggleAutoFollow,
}: AppKeyboardHandlersConfig) {
  const paneRegistry = useSessionPaneRegistry();

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

    useWorkspaceViewStore.getState().activateView('sessions');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sidebarRef.current?.focusSessionPanel();
      });
    });
  }, [sidebarRef]);

  const focusTerminalPanel = useCallback(() => {
    if (window.innerWidth < 640) useWorkspaceViewStore.getState().setMobileTerminalOpen(true);
    else useWorkspaceViewStore.getState().activateView('terminals');
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
    if (window.innerWidth < 640) useWorkspaceViewStore.getState().setMobileTerminalOpen(false);
    else useWorkspaceViewStore.getState().hideView('terminals');
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
    if (window.innerWidth < 640) useChatLayoutStore.getState().setMobileSurface('chat');
    const focusedSessionId = useSessionBoardStore.getState().focusedSessionId;
    if (focusedSessionId) useSessionBoardStore.getState().focusSession(focusedSessionId);
    requestAnimationFrame(() => {
      const focusedPane = focusedSessionId ? paneRegistry.getHandle(focusedSessionId) : undefined;
      if (focusedPane) focusedPane.focusInput();
      else chatInputRef.current?.focus();
    });
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

  const focusDock = useCallback((position: DockPosition) => {
    useDockStore.getState().setDockOpen(position, true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const dock = document.querySelector<HTMLElement>(`[data-dock-position="${position}"]`);
        if (dock?.contains(document.activeElement)) return;
        const target = dock?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
          ?? dock?.querySelector<HTMLElement>('[data-workspace-panel-menu]');
        target?.focus({ preventScroll: true });
      });
    });
  }, []);

  const handleCloseFocusedDock = useCallback(() => {
    const activeEl = document.activeElement;
    if (window.innerWidth >= 640) {
      const position = (focusedWorkspaceGroup() ?? activeEl)?.closest<HTMLElement>('[data-dock-position]')?.dataset.dockPosition;
      if (position === 'left' || position === 'right' || position === 'bottom') {
        useDockStore.getState().setDockOpen(position, false);
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>('[data-dock-position="center"] [role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
        });
      }
      return;
    }
    const view = activeEl?.closest<HTMLElement>('[data-workspace-view]')?.dataset.workspaceView;
    if (view && isFileViewId(view)) {
      useChatLayoutStore.getState().setMobileSurface('files');
    } else if (isWorkspaceViewId(view)) {
      if (view === 'terminals') handleCloseTerminal();
      else useChatLayoutStore.getState().setMobileSurface(view === 'editor' ? 'files' : 'chat');
    } else if (activeEl?.closest('[data-terminal-panel]')) {
      handleCloseTerminal();
    } else if (activeEl?.closest('[data-editor-surface]')) {
      useChatLayoutStore.getState().setMobileSurface('files');
    } else {
      useChatLayoutStore.getState().setMobileSurface('chat');
    }
  }, [handleCloseTerminal]);

  const handleStopStreaming = useCallback(() => {
    handleInterruptSession();
  }, [handleInterruptSession]);

  const getFocusedTabs = useCallback(() => {
    // Read the rendered strip so hidden views and unavailable resources never
    // consume an index. Clicking reuses each tab's session/file activation path.
    const group = focusedWorkspaceGroup()
      ?? document.activeElement?.closest('[data-view-group], [data-mobile-tab-group]')
      ?? document.querySelector('[data-dock-position="center"] [data-view-group]')
      ?? document.querySelector('[data-mobile-tab-group]');
    return Array.from(group?.querySelectorAll<HTMLButtonElement>('[data-workspace-tab-id] > [role="tab"]') ?? [])
      .filter((tab) => !tab.closest('[inert], [hidden], [aria-hidden="true"]'));
  }, []);

  const handleFocusTab = useCallback((index: number) => {
    const tab = getFocusedTabs()[index];
    tab?.click();
    tab?.focus({ preventScroll: true });
  }, [getFocusedTabs]);

  const handleCycleTab = useCallback((direction: -1 | 1) => {
    const tabs = getFocusedTabs();
    if (tabs.length < 2) return;
    const index = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    const target = tabs[(Math.max(0, index) + direction + tabs.length) % tabs.length];
    target.click();
    target.focus({ preventScroll: true });
  }, [getFocusedTabs]);

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
    onFocusLeftDock: () => window.innerWidth < 640 ? focusSidebarSessionPanelRef.current() : focusDock('left'),
    onFocusBottomDock: () => window.innerWidth < 640 ? focusTerminalPanelRef.current() : focusDock('bottom'),
    onFocusRightDock: () => window.innerWidth < 640 ? focusFilesPanelRef.current() : focusDock('right'),
    onNewSession: handleNewSession,
    onToggleViewMode: handleToggleViewMode,
    onCloseFocusedDock: handleCloseFocusedDock,
    onFocusChatInput: focusChatInput,
    onStopStreaming: handleStopStreaming,
    onToggleAutoFollow: handleToggleAutoFollow,
    onFocusTab: handleFocusTab,
    onCycleTab: handleCycleTab,
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
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);
  const preconfigs = useServerDataStore((s) => s.preconfigs);
  const primaryPreconfigs = preconfigs.filter((p) => p.mode !== 'subagent');

  useAppKeyboardHandlers({ ...props, activeWorkspace, primaryPreconfigs });

  return null;
}
