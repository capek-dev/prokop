/**
 * S5 session-search query port. Shapes are structural copies of the Capek
 * `SessionSearchHost` result contracts so the adapter passes values through
 * without reshaping. Projection, mutation, and backfill stay at their
 * current compatibility path until S6.
 */
export interface SessionSearchMessageResult {
  messageId: string;
  sessionId: string;
  workspaceId: string;
  role: string;
  content: string;
  timestamp: number;
  sessionTitle: string | null;
  rank: number;
}

export interface SessionSearchOptions {
  query: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
  roleFilter: string[];
  limit: number;
  sort: 'relevance' | 'newest' | 'oldest';
}

export interface SessionSearchMessageRef {
  id: string;
  timestamp: number;
}

export interface SessionSearchMessageListItem {
  id: string;
  role: string;
  timestamp: number;
}

export interface SessionSearchMessageSummary {
  role: string;
  timestamp: number;
  content: string;
  toolName: string;
}

/** Read-only message search and lookup operations mirroring the pre-S5
 * queries exactly: ordering, sanitization, fallback, snippet bounds, and
 * return shapes are unchanged. */
export interface SessionSearchQueryPort {
  searchMessages(options: SessionSearchOptions): SessionSearchMessageResult[];
  countSessionMessages(sessionId: string): number;
  countMessagesBefore(sessionId: string, timestamp: number): number;
  countMessagesAfter(sessionId: string, timestamp: number): number;
  getLatestMessage(sessionId: string): SessionSearchMessageRef | null;
  getMessage(messageId: string, sessionId: string): SessionSearchMessageRef | null;
  listMessagesBefore(
    sessionId: string,
    timestamp: number,
    limit: number,
  ): SessionSearchMessageListItem[];
  listMessagesAfter(
    sessionId: string,
    timestamp: number,
    limit: number,
  ): SessionSearchMessageListItem[];
  getMessageSummary(messageId: string): SessionSearchMessageSummary | null;
}
