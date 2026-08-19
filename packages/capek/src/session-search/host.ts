import type { Session, Workspace } from '@capekai/types';

export interface SearchMessageResult {
  messageId: string;
  sessionId: string;
  workspaceId: string;
  role: string;
  content: string;
  timestamp: number;
  sessionTitle: string | null;
  rank: number;
}

export interface SessionSearchHost {
  getWorkspace(id: string): Promise<Workspace | null>;
  getSession(id: string): Promise<Session | null>;
  listWorkspaceSessions(workspaceId: string): Promise<Session[]>;
  listAgentSessions(agentId: string, limit: number): Promise<Session[]>;
  countSessionMessages(sessionId: string): Promise<number>;
  searchMessages(options: {
    query: string;
    workspaceId?: string;
    agentId?: string;
    sessionId?: string;
    roleFilter: string[];
    limit: number;
    sort: 'relevance' | 'newest' | 'oldest';
  }): Promise<SearchMessageResult[]>;
  countMessagesBefore(sessionId: string, timestamp: number): Promise<number>;
  countMessagesAfter(sessionId: string, timestamp: number): Promise<number>;
  getLatestMessage(sessionId: string): Promise<{ id: string; timestamp: number } | null>;
  getMessage(messageId: string, sessionId: string): Promise<{ id: string; timestamp: number } | null>;
  listMessagesBefore(sessionId: string, timestamp: number, limit: number): Promise<Array<{ id: string; role: string; timestamp: number }>>;
  listMessagesAfter(sessionId: string, timestamp: number, limit: number): Promise<Array<{ id: string; role: string; timestamp: number }>>;
  getMessageSummary(messageId: string): Promise<{ role: string; timestamp: number; content: string; toolName: string } | null>;
}

const emptyHost: SessionSearchHost = {
  getWorkspace: async () => null,
  getSession: async () => null,
  listWorkspaceSessions: async () => [],
  listAgentSessions: async () => [],
  countSessionMessages: async () => 0,
  searchMessages: async () => [],
  countMessagesBefore: async () => 0,
  countMessagesAfter: async () => 0,
  getLatestMessage: async () => null,
  getMessage: async () => null,
  listMessagesBefore: async () => [],
  listMessagesAfter: async () => [],
  getMessageSummary: async () => null,
};

let host = emptyHost;
export function configureSessionSearchHost(value?: SessionSearchHost): void { host = value ?? emptyHost; }
export function getSessionSearchHost(): SessionSearchHost { return host; }
