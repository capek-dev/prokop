import type { ServerMessage } from '@prokopai/sdk';

/**
 * Create a mock ServerWebSocket for integration tests.
 *
 * Captures all sent messages so tests can verify handler responses.
 * Mimics the subset of ServerWebSocket that handlers actually use:
 *   - send(data: string) — accumulates parsed ServerMessages
 *   - data — the WsData object set during upgrade/open
 *   - readyState — always OPEN
 */
export function createMockWs(data?: Record<string, unknown>): MockServerWebSocket {
  const sentMessages: ServerMessage[] = [];

  return {
    send(message: string) {
      sentMessages.push(JSON.parse(message));
    },
    data: data ?? {},
    readyState: WebSocket.OPEN,
    get sentMessages() {
      return sentMessages;
    },
    lastMessage<T extends ServerMessage = ServerMessage>(): T | undefined {
      return sentMessages[sentMessages.length - 1] as T | undefined;
    },
    messagesOfType<T extends ServerMessage>(type: string): T[] {
      return sentMessages.filter(m => m.type === type) as T[];
    },
    clear() {
      sentMessages.length = 0;
    },
    close() {},
  } as unknown as MockServerWebSocket;
}

export interface MockServerWebSocket {
  send: (message: string) => void;
  data: Record<string, unknown>;
  readyState: number;
  sentMessages: ServerMessage[];
  lastMessage: <T extends ServerMessage>() => T | undefined;
  messagesOfType: <T extends ServerMessage>(type: string) => T[];
  clear: () => void;
  close: () => void;
}
