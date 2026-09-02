import { create } from 'zustand';
import type { PermissionRiskLevel, ScheduledJob } from '@prokopai/sdk';
import type { UseBoundStore, StoreApi } from 'zustand';

// --- Configuration Section (deep-linking) ---
export type ConfigurationSection =
  // Preferences
  | 'account'
  | 'appearance'
  | 'keybinds'
  | 'files'
  // Server
  | 'providers'
  | 'models'
  | 'prompts'
  | 'preconfigs'
  | 'response-formats'
  | 'env'
  | 'tools';

// --- Default File Open Mode ---
export type DefaultFileOpenMode = 'preview' | 'edit';

interface ConfigurationSectionState {
  configurationSection: ConfigurationSection;
}

interface ConfigurationSectionActions {
  setConfigurationSection: (section: ConfigurationSection) => void;
}

// --- Dialogs ---
interface DialogState {
  showSettings: boolean;
  showConfiguration: boolean;
  showTools: boolean;
  showMCPDialog: boolean;
  showWorkspacePermissions: boolean;
  showWorkspaceSettings: boolean;
}

interface DialogActions {
  setShowSettings: (show: boolean) => void;
  setShowConfiguration: (show: boolean) => void;
  setShowTools: (show: boolean) => void;
  setShowMCPDialog: (show: boolean) => void;
  setShowWorkspacePermissions: (show: boolean) => void;
  setShowWorkspaceSettings: (show: boolean) => void;
}

// --- File Preview ---
export interface FilePreviewTarget {
  workspaceId: string;
  path: string;
  name: string;
  root?: string;
}

interface FilePreviewState {
  filePreviewTarget: FilePreviewTarget | null;
}

interface FilePreviewActions {
  openFilePreview: (target: FilePreviewTarget) => void;
  closeFilePreview: () => void;
}

// --- Scheduler Modal ---
interface SchedulerModalState {
  showSchedulerJob: boolean;
  editingSchedulerJob: ScheduledJob | null;
}

interface SchedulerModalActions {
  setShowSchedulerJob: (show: boolean, job?: ScheduledJob | null) => void;
}

// --- Settings ---
const CHAT_FINISH_SOUND_KEY = 'prokopai_sound_chat_finish_enabled';
const PERMISSION_SOUND_KEY = 'prokopai_sound_permission_enabled';
const DEFAULT_FILE_OPEN_MODE_KEY = 'prokopai_default_file_open_mode';

const getStoredBoolean = (key: string, fallback: boolean): boolean => {
  if (typeof window === 'undefined') return fallback;
  const stored = localStorage.getItem(key);
  return stored !== null ? stored === 'true' : fallback;
};

function getStoredFileOpenMode(): DefaultFileOpenMode {
  if (typeof window === 'undefined') return 'preview';
  const stored = localStorage.getItem(DEFAULT_FILE_OPEN_MODE_KEY);
  return stored === 'edit' ? 'edit' : 'preview';
}

interface SettingsState {
  chatFinishSoundEnabled: boolean;
  permissionSoundEnabled: boolean;
  defaultFileOpenMode: DefaultFileOpenMode;
}

interface SettingsActions {
  setChatFinishSoundEnabled: (enabled: boolean) => void;
  setPermissionSoundEnabled: (enabled: boolean) => void;
  setDefaultFileOpenMode: (mode: DefaultFileOpenMode) => void;
}

// --- Auto-Approve Severity ---
const AUTO_APPROVE_KEY = 'prokopai_auto_approve_severity';

function loadAutoApproveMap(): Record<string, PermissionRiskLevel | 'off'> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(AUTO_APPROVE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function persistAutoApproveMap(map: Record<string, PermissionRiskLevel | 'off'>): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(AUTO_APPROVE_KEY, JSON.stringify(map));
  }
}

interface AutoApproveState {
  autoApproveBySession: Record<string, PermissionRiskLevel | 'off'>;
}

interface AutoApproveActions {
  setAutoApproveMaxSeverity: (sessionId: string, level: PermissionRiskLevel | 'off') => void;
  getAutoApproveMaxSeverity: (sessionId: string) => PermissionRiskLevel | 'off' | null;
}

// --- Combined Store ---
type UIStore = DialogState & DialogActions & ConfigurationSectionState & ConfigurationSectionActions & SettingsState & SettingsActions & FilePreviewState & FilePreviewActions & AutoApproveState & AutoApproveActions & SchedulerModalState & SchedulerModalActions;

export const useUIStore: UseBoundStore<StoreApi<UIStore>> = create<UIStore>((set) => ({
  // --- Dialogs ---
  showSettings: false,
  showConfiguration: false,
  showTools: false,
  showMCPDialog: false,
  showWorkspacePermissions: false,
  showWorkspaceSettings: false,

  // Open the unified settings dialog (preference or server section)
  setShowSettings: (show: boolean) => set({ showConfiguration: show, showSettings: show }),
  setShowConfiguration: (show) => set({ showConfiguration: show }),
  setShowTools: (show) => set({ showTools: show }),
  setShowMCPDialog: (show) => set({ showMCPDialog: show }),
  setShowWorkspacePermissions: (show) => set({ showWorkspacePermissions: show }),
  setShowWorkspaceSettings: (show) => set({ showWorkspaceSettings: show }),

  // --- Configuration Section ---
  configurationSection: 'providers',
  setConfigurationSection: (section) => set({ configurationSection: section }),

  // --- Settings ---
  chatFinishSoundEnabled: getStoredBoolean(CHAT_FINISH_SOUND_KEY, true),
  permissionSoundEnabled: getStoredBoolean(PERMISSION_SOUND_KEY, true),
  defaultFileOpenMode: getStoredFileOpenMode(),

  setChatFinishSoundEnabled: (enabled) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(CHAT_FINISH_SOUND_KEY, String(enabled));
    }
    set({ chatFinishSoundEnabled: enabled });
  },
  setPermissionSoundEnabled: (enabled) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(PERMISSION_SOUND_KEY, String(enabled));
    }
    set({ permissionSoundEnabled: enabled });
  },
  setDefaultFileOpenMode: (mode) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(DEFAULT_FILE_OPEN_MODE_KEY, mode);
    }
    set({ defaultFileOpenMode: mode });
  },

  // --- File Preview ---
  filePreviewTarget: null,

  openFilePreview: (target) => set({ filePreviewTarget: target }),
  closeFilePreview: () => set({ filePreviewTarget: null }),

  // --- Auto-Approve Severity ---
  autoApproveBySession: loadAutoApproveMap(),

  setAutoApproveMaxSeverity: (sessionId, level) =>
    set((state) => {
      const next = { ...state.autoApproveBySession };
      next[sessionId] = level;
      persistAutoApproveMap(next);
      return { autoApproveBySession: next };
    }),

  getAutoApproveMaxSeverity: (sessionId): PermissionRiskLevel | 'off' | null => {
    return useUIStore.getState().autoApproveBySession[sessionId] ?? null;
  },

  // --- Scheduler Modal ---
  showSchedulerJob: false,
  editingSchedulerJob: null,

  setShowSchedulerJob: (show, job = null) => set({ showSchedulerJob: show, editingSchedulerJob: show ? job : null }),
}));
