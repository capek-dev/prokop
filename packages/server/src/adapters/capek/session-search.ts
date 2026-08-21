import {
  configureSessionSearchHost,
  type SessionSearchHost,
} from '@capekai/core/hosts';
import type { Session, Workspace } from '@prokopai/sdk';
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
  getWorkspace: async (id) => activeDeps?.workspaces.getWorkspace(id) ?? null,
  getSession: async (id) => activeDeps?.sessions.getSession(id) ?? null,
  listWorkspaceSessions: async (workspaceId) => activeDeps?.sessions.listWorkspaceSessions(workspaceId) ?? [],
  listAgentSessions: async (agentId, limit) => activeDeps?.sessions.listAgentSessions(agentId, limit) ?? [],
  countSessionMessages: async (sessionId) => activeDeps?.query.countSessionMessages(sessionId) ?? 0,
  searchMessages: async (options) => activeDeps?.query.searchMessages(options) ?? [],
  countMessagesBefore: async (sessionId, timestamp) => activeDeps?.query.countMessagesBefore(sessionId, timestamp) ?? 0,
  countMessagesAfter: async (sessionId, timestamp) => activeDeps?.query.countMessagesAfter(sessionId, timestamp) ?? 0,
  getLatestMessage: async (sessionId) => activeDeps?.query.getLatestMessage(sessionId) ?? null,
  getMessage: async (messageId, sessionId) => activeDeps?.query.getMessage(messageId, sessionId) ?? null,
  listMessagesBefore: async (sessionId, timestamp, limit) =>
    activeDeps?.query.listMessagesBefore(sessionId, timestamp, limit) ?? [],
  listMessagesAfter: async (sessionId, timestamp, limit) =>
    activeDeps?.query.listMessagesAfter(sessionId, timestamp, limit) ?? [],
  getMessageSummary: async (messageId) => activeDeps?.query.getMessageSummary(messageId) ?? null,
};

export function createJean2SessionSearchHost(deps: Jean2SessionSearchHostDeps): SessionSearchHost {
  return {
    getWorkspace: async (id) => deps.workspaces.getWorkspace(id),
    getSession: async (id) => deps.sessions.getSession(id),
    listWorkspaceSessions: async (workspaceId) => deps.sessions.listWorkspaceSessions(workspaceId),
    listAgentSessions: async (agentId, limit) => deps.sessions.listAgentSessions(agentId, limit),
    countSessionMessages: async (sessionId) => deps.query.countSessionMessages(sessionId),
    searchMessages: async (options) => deps.query.searchMessages(options),
    countMessagesBefore: async (sessionId, timestamp) => deps.query.countMessagesBefore(sessionId, timestamp),
    countMessagesAfter: async (sessionId, timestamp) => deps.query.countMessagesAfter(sessionId, timestamp),
    getLatestMessage: async (sessionId) => deps.query.getLatestMessage(sessionId),
    getMessage: async (messageId, sessionId) => deps.query.getMessage(messageId, sessionId),
    listMessagesBefore: async (sessionId, timestamp, limit) => deps.query.listMessagesBefore(sessionId, timestamp, limit),
    listMessagesAfter: async (sessionId, timestamp, limit) => deps.query.listMessagesAfter(sessionId, timestamp, limit),
    getMessageSummary: async (messageId) => deps.query.getMessageSummary(messageId),
  };
}

/** Passing deps configures them; no-arg call resets to empty-host defaults
 * so tests can restore a deterministic state after fake-deps wiring. */
export function configureJean2SessionSearchHost(deps?: Jean2SessionSearchHostDeps): void {
  activeDeps = deps ?? null;
  configureSessionSearchHost(jean2SessionSearchHost);
}
