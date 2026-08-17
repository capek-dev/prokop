import {
  configureSessionSearchHost,
  type SessionSearchHost,
} from '@capekai/core/internal/hosts';
import type { Session, Workspace } from '@jean2/sdk';
import type { SessionSearchQueryPort } from '@/application/ports/session-search';

/** S5 Capek session-search adapter: translates `SessionSearchHost` calls
 * onto the query port plus session and workspace lookups. No store, SQL, or
 * infrastructure imports; the composition root injects concrete deps. */
export interface Jean2SessionSearchHostSessionAccess {
  getSession(id: string): Session | null;
  listWorkspaceSessions(workspaceId: string): Session[];
  listAgentSessions(agentId: string, limit: number): Session[];
}

export interface Jean2SessionSearchHostWorkspaceAccess {
  getWorkspace(id: string): Workspace | null;
}

export interface Jean2SessionSearchHostDeps {
  query: SessionSearchQueryPort;
  sessions: Jean2SessionSearchHostSessionAccess;
  workspaces: Jean2SessionSearchHostWorkspaceAccess;
}

let activeDeps: Jean2SessionSearchHostDeps | null = null;

/** Module-level host identity preserved for the S1 forwarding path. Null
 * deps answer with the Capek empty-host semantics (null, zero, empty lists). */
export const jean2SessionSearchHost: SessionSearchHost = {
  getWorkspace: (id) => activeDeps?.workspaces.getWorkspace(id) ?? null,
  getSession: (id) => activeDeps?.sessions.getSession(id) ?? null,
  listWorkspaceSessions: (workspaceId) => activeDeps?.sessions.listWorkspaceSessions(workspaceId) ?? [],
  listAgentSessions: (agentId, limit) => activeDeps?.sessions.listAgentSessions(agentId, limit) ?? [],
  countSessionMessages: (sessionId) => activeDeps?.query.countSessionMessages(sessionId) ?? 0,
  searchMessages: (options) => activeDeps?.query.searchMessages(options) ?? [],
  countMessagesBefore: (sessionId, timestamp) => activeDeps?.query.countMessagesBefore(sessionId, timestamp) ?? 0,
  countMessagesAfter: (sessionId, timestamp) => activeDeps?.query.countMessagesAfter(sessionId, timestamp) ?? 0,
  getLatestMessage: (sessionId) => activeDeps?.query.getLatestMessage(sessionId) ?? null,
  getMessage: (messageId, sessionId) => activeDeps?.query.getMessage(messageId, sessionId) ?? null,
  listMessagesBefore: (sessionId, timestamp, limit) =>
    activeDeps?.query.listMessagesBefore(sessionId, timestamp, limit) ?? [],
  listMessagesAfter: (sessionId, timestamp, limit) =>
    activeDeps?.query.listMessagesAfter(sessionId, timestamp, limit) ?? [],
  getMessageSummary: (messageId) => activeDeps?.query.getMessageSummary(messageId) ?? null,
};

export function createJean2SessionSearchHost(deps: Jean2SessionSearchHostDeps): SessionSearchHost {
  return {
    getWorkspace: (id) => deps.workspaces.getWorkspace(id),
    getSession: (id) => deps.sessions.getSession(id),
    listWorkspaceSessions: (workspaceId) => deps.sessions.listWorkspaceSessions(workspaceId),
    listAgentSessions: (agentId, limit) => deps.sessions.listAgentSessions(agentId, limit),
    countSessionMessages: (sessionId) => deps.query.countSessionMessages(sessionId),
    searchMessages: (options) => deps.query.searchMessages(options),
    countMessagesBefore: (sessionId, timestamp) => deps.query.countMessagesBefore(sessionId, timestamp),
    countMessagesAfter: (sessionId, timestamp) => deps.query.countMessagesAfter(sessionId, timestamp),
    getLatestMessage: (sessionId) => deps.query.getLatestMessage(sessionId),
    getMessage: (messageId, sessionId) => deps.query.getMessage(messageId, sessionId),
    listMessagesBefore: (sessionId, timestamp, limit) => deps.query.listMessagesBefore(sessionId, timestamp, limit),
    listMessagesAfter: (sessionId, timestamp, limit) => deps.query.listMessagesAfter(sessionId, timestamp, limit),
    getMessageSummary: (messageId) => deps.query.getMessageSummary(messageId),
  };
}

/** Passing deps configures them; no-arg call resets to empty-host defaults
 * so tests can restore a deterministic state after fake-deps wiring. */
export function configureJean2SessionSearchHost(deps?: Jean2SessionSearchHostDeps): void {
  activeDeps = deps ?? null;
  configureSessionSearchHost(jean2SessionSearchHost);
}
