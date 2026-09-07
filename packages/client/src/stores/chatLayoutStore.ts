import { create } from 'zustand';
import { useServerDataStore } from './serverDataStore';
import { useSessionBoardStore } from './sessionBoardStore';
import {
  PANEL_DEFAULT_WIDTH,
  clampPanelWidth,
} from '@prokopai/sdk';
import {
  getSessionsPanelWidth,
  saveSessionsPanelWidth,
  getFilesPanelWidth,
  saveFilesPanelWidth,
} from '@/config/panelStorage';

export type FilesPanelTab = 'project' | 'changes' | 'branches' | 'worktrees';
export type WorkbenchSurface = 'explorer' | 'changes' | 'branches' | 'worktrees' | 'editor';
export type MobileSurface = 'chat' | 'sessions' | 'files' | 'editor';

interface SessionFilesLayout {
  filesPanelTab: FilesPanelTab;
  filesPanelRoot: string | null;
  filesPanelRootPinned: boolean;
  workbenchSurface: WorkbenchSurface;
}
const defaultSessionFilesLayout: SessionFilesLayout = {
  filesPanelTab: 'project', filesPanelRoot: null, filesPanelRootPinned: false, workbenchSurface: 'explorer',
};
function scopeKey(serverId: string | null, workspaceId: string | undefined, sessionId: string | null): string | null {
  return serverId && workspaceId && sessionId ? JSON.stringify([serverId, workspaceId, sessionId]) : null;
}
function updateSessionLayout(state: ChatLayoutState, patch: Partial<SessionFilesLayout>): Partial<ChatLayoutState> {
  const server = useServerDataStore.getState();
  const key = scopeKey(server.serverId, server.activeWorkspace?.id, useSessionBoardStore.getState().focusedSessionId);
  return key ? { sessionFilesLayouts: { ...state.sessionFilesLayouts, [key]: { ...(state.sessionFilesLayouts[key] ?? defaultSessionFilesLayout), ...patch } } } : patch;
}

interface ChatLayoutState {
  sessionFilesLayouts: Record<string, SessionFilesLayout>;
  showFilesPanel: boolean;
  showTerminalPanel: boolean;
  sessionsPanelWidth: number;
  filesPanelWidth: number;
  filesPanelTab: FilesPanelTab;
  filesPanelRoot: string | null;
  filesPanelRootPinned: boolean;
  workbenchSurface: WorkbenchSurface;
  mobileSurface: MobileSurface;
}

interface ChatLayoutActions {
  setShowFilesPanel: (show: boolean) => void;
  setShowTerminalPanel: (show: boolean) => void;
  setSessionsPanelWidth: (width: number) => void;
  setFilesPanelWidth: (width: number) => void;
  setFilesPanelTab: (tab: FilesPanelTab) => void;
  setFilesPanelRoot: (root: string | null) => void;
  setFilesPanelRootPinned: (pinned: boolean) => void;
  setWorkbenchSurface: (surface: WorkbenchSurface) => void;
  setMobileSurface: (surface: MobileSurface) => void;
}

type ChatLayoutStore = ChatLayoutState & ChatLayoutActions;

const getInitialSessionsPanelWidth = (): number => {
  return getSessionsPanelWidth(PANEL_DEFAULT_WIDTH);
};

const getInitialFilesPanelWidth = (): number => {
  return getFilesPanelWidth(PANEL_DEFAULT_WIDTH);
};

export const useChatLayoutStore = create<ChatLayoutStore>((set) => ({
  sessionFilesLayouts: {},
  showFilesPanel: false,
  showTerminalPanel: false,
  sessionsPanelWidth: getInitialSessionsPanelWidth(),
  filesPanelWidth: getInitialFilesPanelWidth(),
  filesPanelTab: 'project',
  filesPanelRoot: null,
  filesPanelRootPinned: false,
  workbenchSurface: 'explorer',
  mobileSurface: 'chat',

  setShowFilesPanel: (show) => set({ showFilesPanel: show }),
  setShowTerminalPanel: (show) => set({ showTerminalPanel: show }),
  setSessionsPanelWidth: (width) => {
    const clampedWidth = clampPanelWidth(width);
    saveSessionsPanelWidth(clampedWidth);
    set({ sessionsPanelWidth: clampedWidth });
  },
  setFilesPanelWidth: (width) => {
    const clampedWidth = clampPanelWidth(width);
    saveFilesPanelWidth(clampedWidth);
    set({ filesPanelWidth: clampedWidth });
  },
  setFilesPanelTab: (tab) => set((state) => updateSessionLayout(state, { filesPanelTab: tab })),
  setFilesPanelRoot: (root) => set((state) => updateSessionLayout(state, { filesPanelRoot: root })),
  setFilesPanelRootPinned: (filesPanelRootPinned) => set((state) => updateSessionLayout(state, { filesPanelRootPinned })),
  setWorkbenchSurface: (workbenchSurface) => set((state) => updateSessionLayout(state, { workbenchSurface })),
  setMobileSurface: (mobileSurface) => set({ mobileSurface }),
}));

/** Select session-owned Files preferences without copying state on focus changes. */
export function useSessionChatLayoutStore<T>(selector: (state: ChatLayoutStore) => T): T {
  const serverId = useServerDataStore((state) => state.serverId);
  const workspaceId = useServerDataStore((state) => state.activeWorkspace?.id);
  const sessionId = useSessionBoardStore((state) => state.focusedSessionId);
  const key = scopeKey(serverId, workspaceId, sessionId);
  return useChatLayoutStore((state) => selector(key
    ? { ...state, ...(state.sessionFilesLayouts[key] ?? defaultSessionFilesLayout) }
    : state));
}