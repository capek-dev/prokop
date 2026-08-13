export { initializeFts, backfillFts, indexMessage, removeMessageFromFts, removeSessionFromFts, sanitizeFtsQuery, searchMessages } from './fts';
export { sessionSearchToolDefinition, executeSessionSearchTool } from './session-search-tool';
export type { SessionSearchResult, SessionListEntry } from './session-search-tool';

export { SESSION_SEARCH_GUIDANCE } from '@capekai/core/compat/jean2';
