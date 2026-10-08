import { create } from 'zustand';
import { useServerDataStore } from './serverDataStore';
import { useSessionBoardStore } from './sessionBoardStore';

export type FilesPanelTab = 'project' | 'changes' | 'branches' | 'worktrees';
export type WorkbenchSurface = 'explorer' | 'changes' | 'branches' | 'worktrees' | 'editor';
export type MobileSurface = 'chat' | 'sessions' | 'files' | 'editor' | 'pull-requests';

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
  filesPanelTab: FilesPanelTab;
  filesPanelRoot: string | null;
  filesPanelRootPinned: boolean;
  workbenchSurface: WorkbenchSurface;
  mobileSurface: MobileSurface;
}

interface ChatLayoutActions {
  setFilesPanelTab: (tab: FilesPanelTab) => void;
  setFilesPanelRoot: (root: string | null) => void;
  setFilesPanelRootPinned: (pinned: boolean) => void;
  setWorkbenchSurface: (surface: WorkbenchSurface) => void;
  setMobileSurface: (surface: MobileSurface) => void;
}

type ChatLayoutStore = ChatLayoutState & ChatLayoutActions;

export const useChatLayoutStore = create<ChatLayoutStore>((set) => ({
  sessionFilesLayouts: {},
  filesPanelTab: 'project',
  filesPanelRoot: null,
  filesPanelRootPinned: false,
  workbenchSurface: 'explorer',
  mobileSurface: 'chat',

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
