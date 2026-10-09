import { create } from 'zustand';
import type { Session } from '@prokopai/sdk';

/**
 * Sessions from other machines that are open on this board. The active
 * machine's sessions live in `sessionStore.sessions`; these never do, so an
 * update from one machine cannot replace another machine's list. Content
 * (messages, parts, asks) is keyed by session id and shared, because ids are
 * UUIDs. Persisted so foreign tabs survive a reload.
 */

const STORAGE_KEY = 'prokopai_foreign_sessions';

export interface ForeignSession {
  serverId: string;
  session: Session;
}

interface ForeignSessionsState {
  byId: Record<string, ForeignSession>;
  add: (serverId: string, session: Session) => void;
  /** Updates a tracked session; returns false for sessions this board does not track. */
  update: (session: Session) => boolean;
  remove: (sessionId: string) => void;
  /** Forgets every session of a machine (it became the active machine, so its sessions are local). */
  removeServer: (serverId: string) => void;
}

function load(): Record<string, ForeignSession> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, ForeignSession> : {};
    return Object.fromEntries(Object.entries(parsed).filter(([, entry]) =>
      typeof entry?.serverId === 'string' && typeof entry.session?.id === 'string'));
  } catch {
    return {};
  }
}

function save(byId: Record<string, ForeignSession>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byId));
  } catch {
    // Storage full or unavailable: foreign tabs just won't survive a reload.
  }
}

export const useForeignSessionsStore = create<ForeignSessionsState>((set, get) => ({
  byId: typeof localStorage === 'undefined' ? {} : load(),
  add: (serverId, session) => {
    const byId = { ...get().byId, [session.id]: { serverId, session } };
    set({ byId });
    save(byId);
  },
  update: (session) => {
    const existing = get().byId[session.id];
    if (!existing) return false;
    const byId = { ...get().byId, [session.id]: { ...existing, session } };
    set({ byId });
    save(byId);
    return true;
  },
  removeServer: (serverId) => {
    const byId = Object.fromEntries(Object.entries(get().byId).filter(([, entry]) => entry.serverId !== serverId));
    if (Object.keys(byId).length === Object.keys(get().byId).length) return;
    set({ byId });
    save(byId);
  },
  remove: (sessionId) => {
    if (!get().byId[sessionId]) return;
    const { [sessionId]: _removed, ...byId } = get().byId;
    set({ byId });
    save(byId);
  },
}));

/** The machine a foreign session belongs to; null for the active machine's sessions. */
export function foreignServerOf(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  return useForeignSessionsStore.getState().byId[sessionId]?.serverId ?? null;
}

export function foreignSession(sessionId: string | null | undefined): Session | undefined {
  if (!sessionId) return undefined;
  return useForeignSessionsStore.getState().byId[sessionId]?.session;
}

export function foreignSessionsOf(serverId: string): Session[] {
  return Object.values(useForeignSessionsStore.getState().byId)
    .filter((entry) => entry.serverId === serverId)
    .map((entry) => entry.session);
}
