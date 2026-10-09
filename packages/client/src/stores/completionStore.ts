import { create } from 'zustand';

/**
 * A session whose run finished while you were not looking at it. It stays
 * marked (bold title, accent dot) until you open or focus it, or it starts
 * working again. Kept per device across reloads.
 */
export type CompletionRecord = {
  finishedAt: number;
  failed: boolean;
};

const STORAGE_KEY = 'prokopai_unread_sessions';
/** Bound the stored map; the oldest marks fall off first. */
const MAX_RECORDS = 200;

function load(): Map<string, CompletionRecord> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    const entries = Object.entries(parsed as Record<string, CompletionRecord>)
      .filter(([, record]) => typeof record?.finishedAt === 'number');
    return new Map(entries.map(([id, record]) => [id, { finishedAt: record.finishedAt, failed: !!record.failed }]));
  } catch {
    return new Map();
  }
}

function save(records: Map<string, CompletionRecord>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(records)));
  } catch {
    // Storage unavailable: unread marks last for this page load only.
  }
}

interface CompletionState {
  completionState: Map<string, CompletionRecord>;
}

interface CompletionActions {
  /** Marks a finished run as unread. */
  setCompletion: (sessionId: string, record: CompletionRecord) => void;
  /** Seen, reopened, or working again. */
  clearCompletion: (sessionId: string) => void;
  clearAllCompletions: () => void;
}

type CompletionStore = CompletionState & CompletionActions;

export const useCompletionStore = create<CompletionStore>((set) => ({
  completionState: load(),

  setCompletion: (sessionId, record) => set((state) => {
    const next = new Map(state.completionState);
    next.delete(sessionId);
    next.set(sessionId, record);
    while (next.size > MAX_RECORDS) next.delete(next.keys().next().value!);
    save(next);
    return { completionState: next };
  }),
  clearCompletion: (sessionId) => set((state) => {
    if (!state.completionState.has(sessionId)) return state;
    const next = new Map(state.completionState);
    next.delete(sessionId);
    save(next);
    return { completionState: next };
  }),
  clearAllCompletions: () => set((state) => {
    if (state.completionState.size === 0) return state;
    save(new Map());
    return { completionState: new Map() };
  }),
}));

export const selectCompletionRecord = (sessionId: string) => (state: CompletionStore) =>
  state.completionState.get(sessionId);
