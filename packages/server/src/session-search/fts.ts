import { getDatabase } from '@/infrastructure/sqlite/database';
import {
  backfillFts as backfillFtsWithDb,
  indexMessage as indexMessageWithDb,
  initializeFts as initializeFtsWithDb,
  migrateFtsForAgents as migrateFtsForAgentsWithDb,
  removeMessageFromFts as removeMessageFromFtsWithDb,
  removeSessionFromFts as removeSessionFromFtsWithDb,
  type FtsDatabase,
} from '@/infrastructure/session-search/fts';
import {
  getMessageContentForFts as getMessageContentForFtsWithDb,
  sanitizeFtsQuery,
  searchMessages as searchMessagesWithDb,
} from '@/infrastructure/sqlite/session-search-query-repository';
import type {
  SessionSearchMessageResult,
  SessionSearchOptions,
} from '@/application/ports/session-search';

export type FtsSearchResult = SessionSearchMessageResult;
export type SearchOptions = SessionSearchOptions;

export function searchMessages(options: SearchOptions): FtsSearchResult[] {
  return searchMessagesWithDb(getDatabase(), options);
}

export function getMessageContentForFts(
  messageId: string,
): { content: string; toolName: string } {
  return getMessageContentForFtsWithDb(getDatabase(), messageId);
}

export { sanitizeFtsQuery };

export function initializeFts(db: FtsDatabase): void {
  initializeFtsWithDb(db);
}

export function migrateFtsForAgents(db: FtsDatabase): void {
  migrateFtsForAgentsWithDb(db);
}

export function backfillFts(): number {
  return backfillFtsWithDb(getDatabase());
}

export function indexMessage(
  messageId: string,
  sessionId: string,
  workspaceId: string,
  role: string,
  content: string,
  toolName: string,
  agentId?: string | null,
): void {
  indexMessageWithDb(
    getDatabase(),
    messageId,
    sessionId,
    workspaceId,
    role,
    content,
    toolName,
    agentId,
  );
}

export function removeMessageFromFts(messageId: string): void {
  removeMessageFromFtsWithDb(getDatabase(), messageId);
}

export function removeSessionFromFts(sessionId: string): void {
  removeSessionFromFtsWithDb(getDatabase(), sessionId);
}
