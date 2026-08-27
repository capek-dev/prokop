import { create } from 'zustand';
import {
  getBoardLayoutPreference,
  saveBoardLayoutPreference,
} from '@/config/boardLayoutStorage';

export const MAX_PANES = 6;

export type LayoutMode = 'focused' | 'board' | 'tabs';

/**
 * Intent recorded when a client-initiated session creation is pending.
 * When `session.created` arrives, this intent determines how the new
 * session is applied to the board (replace-focused vs open-alongside).
 */
export interface PendingSessionCreateIntent {
  workspaceId: string;
  boardAction: 'replace-focused' | 'open-alongside';
}

export interface SessionBoardState {
  openSessionIds: string[];
  focusedSessionId: string | null;
  layoutMode: LayoutMode;
}

export interface SessionBoardActions {
  /** Hydrate board state from validated route params. */
  hydrateFromRoute: (focusedSessionId: string | null, openSessionIds: string[]) => void;
  /** Focus a specific open pane. No-op if not open. */
  focusSession: (sessionId: string) => void;
  /** Replace the contents of the focused pane with a new session. */
  openInFocusedPane: (sessionId: string) => void;
  /** Add a new pane alongside existing ones (respects MAX_PANES). */
  openAlongside: (sessionId: string) => void;
  /** Remove a pane from the board, focusing nearest neighbor. */
  removeFromBoard: (sessionId: string) => void;
  /** Move an open session to a new row-major board position. */
  reorderSession: (sessionId: string, targetIndex: number) => void;
  /** Remove any session IDs that are not in the valid set. */
  removeInvalidSessions: (validIds: Set<string>) => void;
  /** Replace an old session ID with a new one (e.g. after fork). */
  replaceSessionId: (oldId: string, newId: string) => void;
  /** Clear all board state. */
  clearBoard: () => void;
  /** Set layout mode. Multi-pane modes persist the preference. */
  setLayoutMode: (mode: LayoutMode) => void;
}

type SessionBoardStore = SessionBoardState & SessionBoardActions;

/**
 * Choose the nearest pane to focus after removing one.
 * Prefers the pane to the left, wrapping to the right edge.
 */
function chooseNextFocus(openIds: string[], removedId: string): string | null {
  const idx = openIds.indexOf(removedId);
  if (idx === -1) return openIds[0] ?? null;

  const remainingIds = openIds.filter(id => id !== removedId);
  if (remainingIds.length === 0) return null;

  return remainingIds[Math.max(0, idx - 1)] ?? remainingIds[0] ?? null;
}

export const useSessionBoardStore = create<SessionBoardStore>((set, get) => ({
  openSessionIds: [],
  focusedSessionId: null,
  layoutMode: 'focused',

  hydrateFromRoute: (focusedSessionId, openSessionIds) => {
    const preference = getBoardLayoutPreference('board');
    set((state) => ({
      openSessionIds,
      focusedSessionId,
      // Route hydration is progressive: the focused session validates first,
      // remaining `open` IDs join once their data loads (overview F5 does one
      // fetch per unknown ID). The board must reveal whenever the route ends
      // up with multiple sessions, not only when hydration started empty.
      layoutMode: openSessionIds.length > 1 ? preference : state.layoutMode,
    }));
  },

  focusSession: (sessionId) => {
    const state = get();
    if (!state.openSessionIds.includes(sessionId)) return;
    if (state.focusedSessionId === sessionId) return;
    set({ focusedSessionId: sessionId });
  },

  openInFocusedPane: (sessionId) => {
    const state = get();
    // If already open, just focus it
    if (state.openSessionIds.includes(sessionId)) {
      set({ focusedSessionId: sessionId });
      return;
    }
    // If no panes, start the board
    if (state.openSessionIds.length === 0) {
      set({ openSessionIds: [sessionId], focusedSessionId: sessionId });
      return;
    }
    // Replace the focused pane
    const focusedIdx = state.focusedSessionId
      ? state.openSessionIds.indexOf(state.focusedSessionId)
      : 0;
    const idx = focusedIdx === -1 ? 0 : focusedIdx;
    const newOpenIds = [...state.openSessionIds];
    newOpenIds[idx] = sessionId;
    set({ openSessionIds: newOpenIds, focusedSessionId: sessionId });
  },

  openAlongside: (sessionId) => {
    const state = get();
    // If already open, focus it and reveal the multi-session layout.
    if (state.openSessionIds.includes(sessionId)) {
      const preference = getBoardLayoutPreference('board');
      set({ focusedSessionId: sessionId, layoutMode: preference });
      return;
    }
    // Respect pane limit
    if (state.openSessionIds.length >= MAX_PANES) return;
    set({
      openSessionIds: [...state.openSessionIds, sessionId],
      focusedSessionId: sessionId,
      layoutMode: getBoardLayoutPreference('board'),
    });
  },

  removeFromBoard: (sessionId) => {
    const state = get();
    const newOpenIds = state.openSessionIds.filter(id => id !== sessionId);
    let newFocus = state.focusedSessionId;
    if (state.focusedSessionId === sessionId) {
      newFocus = chooseNextFocus(state.openSessionIds, sessionId);
    }
    set({
      openSessionIds: newOpenIds,
      focusedSessionId: newFocus,
      layoutMode: newOpenIds.length > 1 ? state.layoutMode : 'focused',
    });
  },

  reorderSession: (sessionId, targetIndex) => {
    const state = get();
    const sourceIndex = state.openSessionIds.indexOf(sessionId);
    if (sourceIndex === -1) return;

    const boundedTargetIndex = Math.max(0, Math.min(targetIndex, state.openSessionIds.length - 1));
    if (sourceIndex === boundedTargetIndex) return;

    const newOpenIds = [...state.openSessionIds];
    const movedSessionId = newOpenIds.splice(sourceIndex, 1)[0];
    if (!movedSessionId) return;
    newOpenIds.splice(boundedTargetIndex, 0, movedSessionId);
    set({ openSessionIds: newOpenIds });
  },

  removeInvalidSessions: (validIds) => {
    const state = get();
    const newOpenIds = state.openSessionIds.filter(id => validIds.has(id));
    let newFocus = state.focusedSessionId;
    if (newFocus && !newOpenIds.includes(newFocus)) {
      newFocus = newOpenIds[0] ?? null;
    }
    if (newOpenIds.length === state.openSessionIds.length && newFocus === state.focusedSessionId) {
      return;
    }
    set({ openSessionIds: newOpenIds, focusedSessionId: newFocus });
  },

  replaceSessionId: (oldId, newId) => {
    const state = get();
    if (!state.openSessionIds.includes(oldId)) return;
    set({
      openSessionIds: state.openSessionIds.map(id => id === oldId ? newId : id),
      focusedSessionId: state.focusedSessionId === oldId ? newId : state.focusedSessionId,
    });
  },

  clearBoard: () => set({ openSessionIds: [], focusedSessionId: null, layoutMode: 'focused' }),

  setLayoutMode: (layoutMode) => {
    if (layoutMode === 'board' || layoutMode === 'tabs') {
      saveBoardLayoutPreference(layoutMode);
    }
    set({ layoutMode });
  },
}));

// ── URL helpers ──────────────────────────────────────────────

/**
 * Parse the `open` search param (comma-separated session IDs) into a deduplicated array.
 */
export function parseOpenSessionIds(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/**
 * Serialize an ordered array of session IDs into the `open` search param value.
 */
export function serializeOpenSessionIds(ids: string[]): string {
  return ids.join(',');
}
