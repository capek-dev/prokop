/**
 * Session persistence and the side effects that must remain ordered with
 * session deletion. The repository is created lazily over the database
 * singleton so database replacement in tests keeps the existing behavior.
 */

import { getDatabase } from './database';
import type { Session, SessionStatus, Workspace } from '@prokopai/sdk';
import { getWorkspace } from './workspaces';
import { deleteAttachmentsForSession, deleteAttachmentsForWorkspace } from './attachments';
import { removeSessionFromFts } from '@/infrastructure/session-search/fts';
import { rmSync, existsSync } from 'fs';
import os from 'node:os';
import path from 'node:path';
import {
  createSessionRepository,
  type SessionDatabaseAccessor,
} from './session-repository';
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
        if (event.type === 'session.deleted') removeSessionFromFts(getDatabase(), event.sessionId);
      },
    },
    deleteAttachmentsForSession,
    deleteAttachmentsForWorkspace,
    cleanupSessionOutputDir,
  };
}

let repository: SessionStorePort | null = null;

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
  updates: Partial<Pick<Session, 'title' | 'status' | 'metadata' | 'preconfigId' | 'selectedModel' | 'selectedProvider' | 'selectedVariant' | 'promptTokens' | 'completionTokens' | 'totalTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'noCacheTokens' | 'parentId' | 'agentName' | 'subagentStatus' | 'runningAt' | 'compacting' | 'tags' | 'autoApproveSeverity' | 'agentId' | 'workspaceRootId'>>,
): Session | null {
  return repo().updateSession(id, updates);
}

export function cleanupWorkspaceSessionsOutputDirs(workspaceId: string): void {
  const sessions = listSessionsByWorkspace(workspaceId);
  for (const session of sessions) {
    cleanupSessionOutputDir(session.id);
  }
}

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

/**
 * Startup reconciliation for chat sessions stuck in "running". A previous
 * process may have died mid-execution (crash, SIGKILL) leaving running_at
 * set with no live execution to clear it. The client treats running_at as
 * streaming, so such sessions could never accept a new prompt again.
 * Returns the number of sessions reconciled.
 */
export function reconcileStuckRunningSessions(): number {
  const sessions = listSessions();
  let reconciled = 0;
  for (const session of sessions) {
    const isStuckRunning = (session.runningAt !== null && session.runningAt !== undefined)
      || session.subagentStatus === 'running';
    if (!isStuckRunning) continue;
    const updates: Partial<Pick<Session, 'runningAt' | 'subagentStatus'>> = { runningAt: null };
    if (session.subagentStatus === 'running') {
      updates.subagentStatus = 'interrupted';
    }
    if (repo().updateSession(session.id, updates)) {
      reconciled++;
    }
  }
  return reconciled;
}

export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from './session-repository';
export { cleanupSessionOutputDir };
