import type { PermissionAsk } from '@capekai/tool'
import type { PermissionRiskLevel } from '@capekai/tool'
import type { Session } from '@capekai/types';
import { getSessionSearchHost, type SessionSearchHost } from './host';

export const sessionSearchToolDefinition = {
  name: 'session_search',
  description: `Search prior conversation messages, list recent sessions, or read session context from the current workspace.
Use it to recall past work, find earlier discussions, or retrieve details that may have been compacted away from active context.
Three modes:
1. List mode (provide "action": "list"): List recent sessions in the workspace with their IDs, titles, and message counts. Use this to discover what sessions exist before reading.
2. Search mode (provide "query"): Full-text search across messages in the workspace or current session.
3. Read-around mode (provide "sessionId", optionally "aroundMessageId"): Read messages surrounding a specific message. If "aroundMessageId" is omitted, reads the latest messages in that session.

Typical workflow: list sessions → read a session's latest context → search for specific keywords if needed.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: { type: 'string' as const, enum: ['list', 'search', 'read'], description: 'The action to perform. "list": enumerate recent sessions. "search": full-text search (default if query provided). "read": read session context. Defaults to "search" if query is provided, "read" if sessionId is provided.' },
      query: { type: 'string' as const, description: 'Search query for full-text search. Triggers search mode.' },
      scope: { type: 'string' as const, enum: ['current_session', 'workspace', 'agent'], description: 'Search scope. "current_session" searches only the current session archive. "workspace" searches all sessions in the workspace. "agent" searches YOUR past sessions across ALL workspaces. Defaults to "workspace".' },
      sessionId: { type: 'string' as const, description: 'Session ID for read-around mode. Use "list" action first to discover session IDs. Must belong to the current workspace or (for agents) be an agent-owned session.' },
      aroundMessageId: { type: 'string' as const, description: 'Anchor message ID for read-around mode. Returns surrounding messages. If omitted, reads the latest messages in the session.' },
      limit: { type: 'number' as const, description: 'Max results for search mode, or max sessions for list mode. Default 5, max 20.' },
      window: { type: 'number' as const, description: 'Number of messages to return around the anchor in read-around mode. Default 8, max 25.' },
      roleFilter: { type: 'array' as const, items: { type: 'string' as const, enum: ['user', 'assistant', 'tool'] }, description: 'Roles to include in results. Defaults to ["user", "assistant"] unless workspace includes tool results.' },
      sort: { type: 'string' as const, enum: ['relevance', 'newest', 'oldest'], description: 'Sort order for search results. Defaults to "relevance".' },
    },
  },
  timeout: 15000,
};

const MAX_CONTENT_LENGTH = 2000;
export interface SessionListEntry { id: string; title: string; messageCount: number; updatedAt: string }
export interface SessionSearchResult {
  success: boolean;
  mode: 'list' | 'search' | 'read';
  title: string;
  sessions?: SessionListEntry[];
  query?: string;
  scope?: string;
  results?: Array<{ sessionId: string; sessionTitle: string | null; messageId: string; role: string; timestamp: number; snippet: string; rank: number; messagesBefore: number; messagesAfter: number }>;
  sessionId?: string;
  sessionTitle?: string | null;
  anchorMessageId?: string;
  anchorInferred?: boolean;
  messagesBefore?: number;
  messagesAfter?: number;
  messages?: Array<{ id: string; role: string; timestamp: number; content: string }>;
  error?: string;
}

/** Unscoped execution path: reads the configured module-level host, exactly
 * like the pre-C5 tool. */
export async function executeSessionSearchTool(input: Record<string, unknown>, workspaceId: string, currentSessionId: string, includeToolResults: boolean, risk: PermissionRiskLevel, askFn?: (ask: PermissionAsk) => Promise<unknown>, agentId?: string | null): Promise<SessionSearchResult> {
  return runSessionSearch(getSessionSearchHost(), input, workspaceId, currentSessionId, includeToolResults, risk, askFn, agentId);
}

/** Composed execution path: the domain plugin captures the process-scoped
 * host service at setup and passes it here, so composed execution never
 * reads the mutable module-global host accessor. */
export async function executeSessionSearchToolWithHost(host: SessionSearchHost, input: Record<string, unknown>, workspaceId: string, currentSessionId: string, includeToolResults: boolean, risk: PermissionRiskLevel, askFn?: (ask: PermissionAsk) => Promise<unknown>, agentId?: string | null): Promise<SessionSearchResult> {
  return runSessionSearch(host, input, workspaceId, currentSessionId, includeToolResults, risk, askFn, agentId);
}

async function runSessionSearch(host: SessionSearchHost, input: Record<string, unknown>, workspaceId: string, currentSessionId: string, includeToolResults: boolean, risk: PermissionRiskLevel, askFn?: (ask: PermissionAsk) => Promise<unknown>, agentId?: string | null): Promise<SessionSearchResult> {
  const workspace = await host.getWorkspace(workspaceId);
  if (!workspace) return { success: false, mode: 'search', title: 'Workspace not found', error: 'Workspace not found' };
  const query = input.query as string | undefined;
  const scope = (input.scope as string) || 'workspace';
  const sessionId = input.sessionId as string | undefined;
  const action = (input.action as string) || (query ? 'search' : sessionId ? 'read' : 'search');
  if (scope === 'agent' && !agentId) {
    return { success: false, mode: action === 'read' ? 'read' : action === 'list' ? 'list' : 'search', title: 'Agent scope unavailable', error: 'Agent scope requires an agent session' };
  }
  if (action === 'list') return executeList(host, workspaceId, currentSessionId, input, scope, agentId);
  if (risk !== 'none' && askFn) {
    const approved = await askFn({ type: 'permission', question: query ? `Allow searching workspace sessions for "${query.slice(0, 100)}"?` : 'Allow reading session context?', description: `Tool: session_search\nWorkspace: ${workspace.name}${query ? `\nQuery: ${query.slice(0, 200)}` : ''}\nScope: ${scope}`, risk, resource: 'session', action: 'read' });
    if (!approved) return { success: false, mode: 'search', title: 'Permission denied', error: 'USER_REJECTION' };
  }
  if (query) return executeSearch(host, query, scope, workspaceId, currentSessionId, includeToolResults, input, agentId);
  if (sessionId) return executeReadAround(host, sessionId, input.aroundMessageId as string | undefined, workspaceId, input, agentId);
  return { success: false, mode: 'search', title: 'Invalid arguments', error: 'Provide "action": "list" to enumerate sessions, "query" for search mode, or "sessionId" for read-around mode.' };
}

async function executeList(host: SessionSearchHost, workspaceId: string, currentSessionId: string, input: Record<string, unknown>, scope: string, agentId?: string | null): Promise<SessionSearchResult> {
  const limit = Math.min(Math.max((input.limit as number) || 10, 1), 20);
  let sessions: Session[];
  let label: string;
  if (scope === 'agent' && agentId) {
    sessions = await host.listAgentSessions(agentId, limit);
    label = 'agent sessions (cross-workspace)';
  } else {
    sessions = await host.listWorkspaceSessions(workspaceId);
    label = scope === 'current_session' ? 'current session' : 'workspace';
  }
  const limited = sessions.slice(0, limit);
  if (limited.length === 0) return { success: true, mode: 'list', title: 'No sessions found', sessions: [] };
  const entries: SessionListEntry[] = [];
  for (const session of limited) {
    entries.push({ id: session.id, title: session.title || '(untitled)', messageCount: await host.countSessionMessages(session.id), updatedAt: session.updatedAt, ...(session.id === currentSessionId && { isCurrent: true }) } as SessionListEntry);
  }
  return { success: true, mode: 'list', title: `${sessions.length} session${sessions.length === 1 ? '' : 's'} (${label})`, sessions: entries };
}

async function executeSearch(host: SessionSearchHost, query: string, scope: string, workspaceId: string, currentSessionId: string, includeTools: boolean, input: Record<string, unknown>, agentId?: string | null): Promise<SessionSearchResult> {
  const limit = Math.min(Math.max((input.limit as number) || 5, 1), 20);
  const sort = ((input.sort as string) || 'relevance') as 'relevance' | 'newest' | 'oldest';
  let roles = (input.roleFilter as string[] | undefined) ?? (includeTools ? ['user', 'assistant', 'tool'] : ['user', 'assistant']);
  roles = roles.filter((role) => ['user', 'assistant', 'tool'].includes(role));
  if (roles.length === 0) roles = ['user', 'assistant'];
  const results = await host.searchMessages({ query, workspaceId: scope === 'agent' ? undefined : workspaceId, agentId: scope === 'agent' ? agentId ?? undefined : undefined, sessionId: scope === 'current_session' ? currentSessionId : undefined, roleFilter: roles, limit, sort });
  if (results.length === 0) return { success: true, mode: 'search', title: 'No prior context found', query, scope, results: [] };
  const mappedResults: NonNullable<SessionSearchResult['results']> = [];
  for (const result of results) {
    mappedResults.push({ sessionId: result.sessionId, sessionTitle: result.sessionTitle, messageId: result.messageId, role: result.role, timestamp: result.timestamp, snippet: result.content, rank: result.rank, messagesBefore: await host.countMessagesBefore(result.sessionId, result.timestamp), messagesAfter: await host.countMessagesAfter(result.sessionId, result.timestamp) });
  }
  return {
    success: true, mode: 'search', title: `Searched ${scope === 'current_session' ? 'current session' : scope === 'agent' ? 'agent sessions (cross-workspace)' : 'workspace sessions'}`, query, scope,
    results: mappedResults,
  };
}

async function executeReadAround(host: SessionSearchHost, sessionId: string, anchorId: string | undefined, workspaceId: string, input: Record<string, unknown>, agentId?: string | null): Promise<SessionSearchResult> {
  const session = await host.getSession(sessionId);
  if (!session) return { success: false, mode: 'read', title: 'Session not found', error: 'Session not found' };
  if (session.workspaceId !== workspaceId && !(agentId && session.agentId === agentId)) return { success: false, mode: 'read', title: 'Access denied', error: 'Session does not belong to current workspace or agent' };
  let inferred = false;
  let anchor = anchorId ? await host.getMessage(anchorId, sessionId) : null;
  if (!anchorId) {
    anchor = await host.getLatestMessage(sessionId);
    inferred = true;
    if (!anchor) return { success: false, mode: 'read', title: 'Empty session', error: 'Session has no messages' };
  }
  if (!anchor) return { success: false, mode: 'read', title: 'Message not found', error: 'Anchor message not found in session' };
  const window = Math.min(Math.max((input.window as number) || 8, 1), 25);
  const half = Math.floor(window / 2);
  const before = await host.listMessagesBefore(sessionId, anchor.timestamp, half);
  const after = await host.listMessagesAfter(sessionId, anchor.timestamp, half);
  const ids = [...before.reverse().map((message) => message.id), anchor.id, ...after.map((message) => message.id)];
  const messages: NonNullable<SessionSearchResult['messages']> = [];
  for (const id of ids) {
    const summary = await host.getMessageSummary(id);
    if (!summary) continue;
    let text = summary.content;
    if (summary.toolName) text = text ? `${text} [tool: ${summary.toolName}]` : `[tool: ${summary.toolName}]`;
    if (text.length > MAX_CONTENT_LENGTH) text = `${text.slice(0, MAX_CONTENT_LENGTH)}...`;
    messages.push({ id, role: summary.role, timestamp: summary.timestamp, content: text || '(no text content)' });
  }
  return { success: true, mode: 'read', title: inferred ? 'Read latest session context' : 'Read session context', sessionId, sessionTitle: session.title, anchorMessageId: anchor.id, ...(inferred && { anchorInferred: true }), messagesBefore: await host.countMessagesBefore(sessionId, anchor.timestamp), messagesAfter: await host.countMessagesAfter(sessionId, anchor.timestamp), messages };
}
