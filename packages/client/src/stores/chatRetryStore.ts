import { create } from 'zustand';
import type { ChatRetryMessage } from '@prokopai/sdk';

interface ChatRetryState {
  retryBySessionId: Record<string, ChatRetryMessage | undefined>;
  applyRetry: (message: ChatRetryMessage) => void;
  clearRetry: (sessionId: string) => void;
}

export const useChatRetryStore = create<ChatRetryState>((set) => ({
  retryBySessionId: {},
  applyRetry: (message) => set((state) => {
    if (message.status === 'cancelled' || message.status === 'exhausted') {
      if (!state.retryBySessionId[message.sessionId]) return state;
      const retryBySessionId = { ...state.retryBySessionId };
      delete retryBySessionId[message.sessionId];
      return { retryBySessionId };
    }
    return {
      retryBySessionId: {
        ...state.retryBySessionId,
        [message.sessionId]: message,
      },
    };
  }),
  clearRetry: (sessionId) => set((state) => {
    if (!state.retryBySessionId[sessionId]) return state;
    const retryBySessionId = { ...state.retryBySessionId };
    delete retryBySessionId[sessionId];
    return { retryBySessionId };
  }),
}));
