/**
 * S5 compat forwarder. Session SQL and row mapping moved to
 * `infrastructure/sqlite/session-repository.ts`; this module keeps every
 * pre-slice export identity and wires the temporary side-effect hooks (FTS
 * removal, attachment deletion, output-dir cleanup) around the repository
 * exactly as before. The store -> compat -> infrastructure path stays
 * temporary until S6/S8 retire it.
 */

import { getDatabase } from './index';
import type { Session, SessionStatus, Workspace } from '@jean2/sdk';
import { getWorkspace } from './workspaces';
import { deleteAttachmentsForSession, deleteAttachmentsForWorkspace } from './attachments';
import { removeSessionFromFts } from '@/session-search/fts';
import { rmSync, existsSync } from 'fs';
import os from 'node:os';
import path from 'node:path';
import {
  createSessionRepository,
  type SessionDatabaseAccessor,
} from '@/infrastructure/sqlite/session-repository';
import type {
  ListSessionPageOptions,
  SessionCursorPayload,
  SessionMessageRepositoryHooks,
  SessionPage,
  SessionPageInfo,
  SessionStorePort,
} from '@/application/ports/session-message';

export type {
  ListSessionPageOptions,
  SessionCursorPayload,
  SessionPage,
  SessionPageInfo,
} from '@/application/ports/session-message';

const OUTPUT_DIR_PREFIX = path.join(os.tmpdir(), 'jean2', '');

function cleanupSessionOutputDir(sessionId: string): void {
  const dir = `${OUTPUT_DIR_PREFIX}${sessionId}`;
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[cleanup] Failed to remove output dir ${dir}:`, err);
    }
  }
}

function buildHooks(): SessionMessageRepositoryHooks {
  return {
    events: {
      publish(event) {
        if (event.type === 'session.deleted') removeSessionFromFts(event.sessionId);
      },
    },
    deleteAttachmentsForSession,
    deleteAttachmentsForWorkspace,
    cleanupSessionOutputDir,
  };
}

let repository: SessionStorePort | null = null;

/** Lazily created compat repository over the current store database
 * accessor, exactly like the other S5 compat modules. */
function repo(): SessionStorePort {
  return (repository ??= createSessionRepository(
    getDatabase as SessionDatabaseAccessor,
    buildHooks(),
  ));
}

export function createSession(
  session: Omit<Session, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string },
): Session {
  return repo().createSession(session);
}

export function getSession(id: string): Session | null {
  return repo().getSession(id);
}

export function getSessionWithWorkspace(sessionId: string): { session: Session; workspace: Workspace | null } | null {
  const session = getSession(sessionId);
  if (!session) {
    return null;
  }

  const workspace = session.workspaceId ? getWorkspace(session.workspaceId) : null;
  return { session, workspace };
}

export function listSessions(status?: SessionStatus): Session[] {
  return repo().listSessions(status);
}

export function updateSession(
  id: string,
  updates: Partial<Pick<Session, 'title' | 'status' | 'metadata' | 'preconfigId' | 'selectedModel' | 'selectedProvider' | 'selectedVariant' | 'promptTokens' | 'completionTokens' | 'totalTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'noCacheTokens' | 'parentId' | 'agentName' | 'subagentStatus' | 'runningAt' | 'compacting' | 'tags' | 'autoApproveSeverity' | 'agentId'>>,
): Session | null {
  return repo().updateSession(id, updates);
}

export function cleanupWorkspaceSessionsOutputDirs(workspaceId: string): void {
  const sessions = listSessionsByWorkspace(workspaceId);
  for (const session of sessions) {
    cleanupSessionOutputDir(session.id);
  }
}

/**
 * Cleanup session output directories for a list of session IDs.
 * Used when deleting a workspace - the sessions may already be removed from DB,
 * so we clean up based on pre-collected session IDs.
 */
export function cleanupSessionsOutputDirs(sessionIds: string[]): void {
  for (const sessionId of sessionIds) {
    cleanupSessionOutputDir(sessionId);
  }
}

export function deleteSession(id: string): boolean {
  return repo().deleteSession(id);
}

export function deleteSessionsByWorkspace(workspaceId: string): void {
  repo().deleteSessionsByWorkspace(workspaceId);
}

export function listSessionsByWorkspace(
  workspaceId: string,
  options?: { status?: SessionStatus; rootOnly?: boolean },
): Session[] {
  return repo().listSessionsByWorkspace(workspaceId, options);
}

export function listSessionsGrouped(
  workspaceIds: string[],
  options?: { status?: SessionStatus; rootOnly?: boolean },
): Record<string, Session[]> {
  return repo().listSessionsGrouped(workspaceIds, options);
}

export function listTagsByWorkspace(workspaceId: string): string[] {
  return repo().listTagsByWorkspace(workspaceId);
}

export function getChildSessions(parentId: string): Session[] {
  return repo().getChildSessions(parentId);
}

export function getSessionsByAgent(agentId: string, sinceTimestamp?: number, limit?: number): Session[] {
  return repo().getSessionsByAgent(agentId, sinceTimestamp, limit);
}

export function encodeSessionCursor(
  payload: SessionCursorPayload,
): string {
  return repo().encodeSessionCursor(payload);
}

export function decodeSessionCursor(
  cursor: string,
): SessionCursorPayload | null {
  return repo().decodeSessionCursor(cursor);
}

export function listSessionPageByWorkspace(
  workspaceId: string,
  options: ListSessionPageOptions,
): SessionPage {
  return repo().listSessionPageByWorkspace(workspaceId, options);
}

export function listSessionPageGrouped(
  workspaceIds: string[],
  options: { status?: SessionStatus; rootOnly?: boolean; limitPerWorkspace: number },
): { sessions: Record<string, Session[]>; pagination: Record<string, SessionPageInfo> } {
  return repo().listSessionPageGrouped(workspaceIds, options);
}

export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from '@/infrastructure/sqlite/session-repository';
export { cleanupSessionOutputDir };
