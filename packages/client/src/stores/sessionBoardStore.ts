import { create } from 'zustand';
import { sessionViewId, useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { foreignServerOf, useForeignSessionsStore } from '@/stores/foreignSessionsStore';

function viewId(sessionId: string) {
  // A session from another machine keeps that machine's id in its view id.
  const serverId = foreignServerOf(sessionId) ?? useServerDataStore.getState().serverId;
  return serverId ? sessionViewId(serverId, sessionId) : null;
}

function revealSession(sessionId: string): void {
  const id = viewId(sessionId);
  if (id) useWorkspaceViewStore.getState().activateView(id);
}

function removeSessionView(sessionId: string): void {
  const id = viewId(sessionId);
  if (id) useWorkspaceViewStore.getState().removeView(id);
  // A closed tab from another machine is forgotten; its connection is released by the view.
  useForeignSessionsStore.getState().remove(sessionId);
}

/** Legacy command intent remains accepted; both actions now open a session tab. */
export interface PendingSessionCreateIntent {
  /** Id sent with session.create; only the matching session.created opens. */
  sessionId: string;
  workspaceId: string;
  boardAction: 'replace-focused' | 'open-alongside';
}

export interface SessionBoardState {
  openSessionIds: string[];
  focusedSessionId: string | null;
}

export interface SessionBoardActions {
  hydrateFromRoute: (focusedSessionId: string | null, openSessionIds: string[]) => void;
  focusSession: (sessionId: string) => void;
  /** Open a session tab or focus its existing placement. */
  openInFocusedPane: (sessionId: string) => void;
  /** Compatibility entry point for opening a session tab. */
  openAlongside: (sessionId: string) => void;
  /** Close only the tab, leaving session data and execution intact. */
  removeFromBoard: (sessionId: string) => void;
  reorderSession: (sessionId: string, targetIndex: number) => void;
  removeInvalidSessions: (validIds: Set<string>) => void;
  replaceSessionId: (oldId: string, newId: string) => void;
  clearBoard: () => void;
}

type SessionBoardStore = SessionBoardState & SessionBoardActions;

/** Session navigation keeps its existing entry point; docks own all geometry. */
export const useSessionBoardStore = create<SessionBoardStore>((set, get) => ({
  openSessionIds: [],
  focusedSessionId: null,

  hydrateFromRoute: (focusedSessionId, openSessionIds) => {
    const previous = get();
    const ids = [...new Set(openSessionIds)];
    for (const id of previous.openSessionIds) {
      if (!ids.includes(id)) removeSessionView(id);
    }
    const views = ids.flatMap((id) => { const view = viewId(id); return view ? [view] : []; });
    useWorkspaceViewStore.getState().ensureViews(views);
    set({ openSessionIds: ids, focusedSessionId });
    if (focusedSessionId && (previous.focusedSessionId !== focusedSessionId || !previous.openSessionIds.includes(focusedSessionId))) {
      revealSession(focusedSessionId);
    }
  },

  focusSession: (sessionId) => {
    if (!get().openSessionIds.includes(sessionId)) return;
    revealSession(sessionId);
    if (get().focusedSessionId !== sessionId) set({ focusedSessionId: sessionId });
  },

  openInFocusedPane: (sessionId) => {
    const state = get();
    set({
      openSessionIds: state.openSessionIds.includes(sessionId) ? state.openSessionIds : [...state.openSessionIds, sessionId],
      focusedSessionId: sessionId,
    });
    revealSession(sessionId);
  },

  openAlongside: (sessionId) => get().openInFocusedPane(sessionId),

  removeFromBoard: (sessionId) => {
    const state = get();
    const index = state.openSessionIds.indexOf(sessionId);
    if (index < 0) return;
    const ids = state.openSessionIds.filter((id) => id !== sessionId);
    const focusedSessionId = state.focusedSessionId === sessionId
      ? ids[Math.max(0, index - 1)] ?? null : state.focusedSessionId;
    removeSessionView(sessionId);
    set({ openSessionIds: ids, focusedSessionId });
    if (focusedSessionId && focusedSessionId !== state.focusedSessionId) revealSession(focusedSessionId);
  },

  reorderSession: (sessionId, targetIndex) => {
    const ids = [...get().openSessionIds];
    const index = ids.indexOf(sessionId);
    if (index < 0) return;
    ids.splice(index, 1);
    ids.splice(Math.max(0, Math.min(targetIndex, ids.length)), 0, sessionId);
    set({ openSessionIds: ids });
  },

  removeInvalidSessions: (validIds) => {
    const state = get();
    const ids = state.openSessionIds.filter((id) => validIds.has(id));
    if (ids.length === state.openSessionIds.length) return;
    for (const id of state.openSessionIds) if (!validIds.has(id)) removeSessionView(id);
    const focusedSessionId = state.focusedSessionId && ids.includes(state.focusedSessionId)
      ? state.focusedSessionId : ids[0] ?? null;
    set({ openSessionIds: ids, focusedSessionId });
    if (focusedSessionId && focusedSessionId !== state.focusedSessionId) revealSession(focusedSessionId);
  },

  replaceSessionId: (oldId, newId) => {
    const state = get();
    if (!state.openSessionIds.includes(oldId)) return;
    const oldView = viewId(oldId);
    const newView = viewId(newId);
    if (oldView && newView) useWorkspaceViewStore.getState().replaceView(oldView, newView);
    set({
      openSessionIds: [...new Set(state.openSessionIds.map((id) => id === oldId ? newId : id))],
      focusedSessionId: state.focusedSessionId === oldId ? newId : state.focusedSessionId,
    });
  },

  clearBoard: () => {
    for (const id of get().openSessionIds) removeSessionView(id);
    set({ openSessionIds: [], focusedSessionId: null });
  },
}));

export function parseOpenSessionIds(raw: string | undefined | null): string[] {
  return [...new Set((raw ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
}

export function serializeOpenSessionIds(ids: string[]): string {
  return ids.join(',');
}
