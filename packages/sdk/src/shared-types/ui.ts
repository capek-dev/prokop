/**
 * Shared types and constants for UI components
 */

/**
 * Panel dimension constraints
 * Used by resizable side panels (sessions, files, etc.)
 */
export const PANEL_MIN_WIDTH = 220;
export const PANEL_DEFAULT_WIDTH = 256;
export const PANEL_MAX_WIDTH = 512;

/**
 * Validates and clamps a panel width to valid bounds
 */
export function clampPanelWidth(width: number): number {
  return Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, width));
}

/**
 * Storage keys for panel state persistence
 */
export const PANEL_STORAGE_KEYS = {
  SESSIONS: 'prokopai_sessions_panel_width',
  FILES: 'prokopai_files_panel_width',
} as const;

/**
 * Saved panel state shape
 */
export interface SavedPanelWidth {
  width: number;
}

export const DRAFT_KEY_PREFIX = 'prokopai_draft_';
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SavedDraft {
  text: string;
  updatedAt: number;
}

export function cleanupExpiredDrafts(): void {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DRAFT_KEY_PREFIX)) {
        continue;
      }

      try {
        const value = localStorage.getItem(key);
        if (!value) {
          continue;
        }

        const draft: SavedDraft = JSON.parse(value);
        if (Date.now() - draft.updatedAt > DRAFT_TTL_MS) {
          localStorage.removeItem(key);
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // localStorage not available
  }
}
