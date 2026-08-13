import type { Session, Workspace } from '@jean2/sdk';

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
  getWorkspace(id: string): Workspace | null;
  getSession(id: string): Session | null;
  listWorkspaceSessions(workspaceId: string): Session[];
  listAgentSessions(agentId: string, limit: number): Session[];
  countSessionMessages(sessionId: string): number;
  searchMessages(options: {
    query: string;
    workspaceId?: string;
    agentId?: string;
    sessionId?: string;
    roleFilter: string[];
    limit: number;
    sort: 'relevance' | 'newest' | 'oldest';
  }): SearchMessageResult[];
  countMessagesBefore(sessionId: string, timestamp: number): number;
  countMessagesAfter(sessionId: string, timestamp: number): number;
  getLatestMessage(sessionId: string): { id: string; timestamp: number } | null;
  getMessage(messageId: string, sessionId: string): { id: string; timestamp: number } | null;
  listMessagesBefore(sessionId: string, timestamp: number, limit: number): Array<{ id: string; role: string; timestamp: number }>;
  listMessagesAfter(sessionId: string, timestamp: number, limit: number): Array<{ id: string; role: string; timestamp: number }>;
  getMessageSummary(messageId: string): { role: string; timestamp: number; content: string; toolName: string } | null;
}

const emptyHost: SessionSearchHost = {
  getWorkspace: () => null,
  getSession: () => null,
  listWorkspaceSessions: () => [],
  listAgentSessions: () => [],
  countSessionMessages: () => 0,
  searchMessages: () => [],
  countMessagesBefore: () => 0,
  countMessagesAfter: () => 0,
  getLatestMessage: () => null,
  getMessage: () => null,
  listMessagesBefore: () => [],
  listMessagesAfter: () => [],
  getMessageSummary: () => null,
};

let host = emptyHost;
export function configureSessionSearchHost(value?: SessionSearchHost): void { host = value ?? emptyHost; }
export function getSessionSearchHost(): SessionSearchHost { return host; }
