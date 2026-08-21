import { create } from 'zustand';
import type { SessionControlState } from '@prokopai/sdk';

export interface ActionRejection {
  sessionId: string;
  action: string;
  code: string;
  message: string;
}

interface SessionControlStore {
  controlBySessionId: Record<string, SessionControlState>;
  lastActionRejection: ActionRejection | null;
  setControlState: (sessionId: string, state: SessionControlState) => void;
  getControlState: (sessionId: string) => SessionControlState | undefined;
  removeControlState: (sessionId: string) => void;
  setActionRejection: (rejection: ActionRejection) => void;
  clearAll: () => void;
}

export const useSessionControlStore = create<SessionControlStore>((set, get) => ({
  controlBySessionId: {},
  lastActionRejection: null,

  setControlState: (sessionId, state) => {
    set(prev => ({
      controlBySessionId: {
        ...prev.controlBySessionId,
        [sessionId]: state,
      },
    }));
  },

  getControlState: (sessionId) => {
    return get().controlBySessionId[sessionId];
  },

  removeControlState: (sessionId) => {
    set(prev => {
      const next = { ...prev.controlBySessionId };
      delete next[sessionId];
      return { controlBySessionId: next };
    });
  },

  setActionRejection: (rejection) => {
    set({ lastActionRejection: rejection });
  },

  clearAll: () => {
    set({ controlBySessionId: {}, lastActionRejection: null });
  },
}));
