/**
 * Persistence for the multi-session board layout preference
 * (tabs vs side-by-side grid).
 */

export type BoardLayoutPreference = 'board' | 'tabs';

const BOARD_LAYOUT_STORAGE_KEY = 'prokopai_board_layout_preference';

export function getBoardLayoutPreference(defaultValue: BoardLayoutPreference): BoardLayoutPreference {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const stored = localStorage.getItem(BOARD_LAYOUT_STORAGE_KEY);
    if (stored === 'board' || stored === 'tabs') return stored;
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

export function saveBoardLayoutPreference(preference: BoardLayoutPreference): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BOARD_LAYOUT_STORAGE_KEY, preference);
  } catch {
    // Ignore persistence errors (private mode, quota).
  }
}
