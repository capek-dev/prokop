import { create } from 'zustand';
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

export type FilesPanelTab = 'project' | 'changes';
export type GitChangesMode = 'grouped' | 'flat';
export type WorkbenchSurface = 'explorer' | 'changes' | 'editor';
export type MobileSurface = 'chat' | 'sessions' | 'files' | 'editor';

interface ChatLayoutState {
  showFilesPanel: boolean;
  showTerminalPanel: boolean;
  sessionsPanelWidth: number;
  filesPanelWidth: number;
  filesPanelTab: FilesPanelTab;
  filesPanelRoot: string | null;
  filesPanelGitMode: GitChangesMode;
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
  setFilesPanelGitMode: (mode: GitChangesMode) => void;
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
  showFilesPanel: false,
  showTerminalPanel: false,
  sessionsPanelWidth: getInitialSessionsPanelWidth(),
  filesPanelWidth: getInitialFilesPanelWidth(),
  filesPanelTab: 'project',
  filesPanelRoot: null,
  filesPanelGitMode: 'grouped',
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
  setFilesPanelTab: (tab) => set({ filesPanelTab: tab }),
  setFilesPanelRoot: (root) => set({ filesPanelRoot: root }),
  setFilesPanelGitMode: (mode) => set({ filesPanelGitMode: mode }),
  setWorkbenchSurface: (workbenchSurface) => set({ workbenchSurface }),
  setMobileSurface: (mobileSurface) => set({ mobileSurface }),
}));