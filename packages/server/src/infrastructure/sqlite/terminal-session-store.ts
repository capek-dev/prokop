/**
 * Terminal session persistence facade. The repository is created once with a
 * lazy database accessor, preserving startup cleanup and database lifecycle
 * behavior while keeping terminal storage in the SQLite infrastructure.
 */

import { getDatabase } from './database';
import { createTerminalSessionRepository } from './terminal-session-repository';
import type {
  CreateTerminalSessionInput,
  TerminalSessionRow,
} from '@/application/ports/terminal';

export type { CreateTerminalSessionInput, TerminalSessionRow };

const repository = createTerminalSessionRepository(() => getDatabase());

export function createTerminalSession(session: CreateTerminalSessionInput): void {
  repository.createTerminalSession(session);
}

export function updateTerminalSessionTitle(id: string, title: string): void {
  repository.updateTerminalSessionTitle(id, title);
}

export function updateTerminalSessionActivity(id: string): void {
  repository.updateTerminalSessionActivity(id);
}

export function markTerminalSessionExited(id: string, exitCode: number): void {
  repository.markTerminalSessionExited(id, exitCode);
}

export function markTerminalSessionDestroyed(id: string): void {
  repository.markTerminalSessionDestroyed(id);
}

export function getTerminalSession(id: string): TerminalSessionRow | null {
  return repository.getTerminalSession(id);
}

export function listTerminalSessions(workspaceId: string): TerminalSessionRow[] {
  return repository.listTerminalSessions(workspaceId);
}

export function listActiveTerminalSessions(workspaceId: string): TerminalSessionRow[] {
  return repository.listActiveTerminalSessions(workspaceId);
}

export function cleanupStaleTerminalSessions(): number {
  return repository.cleanupStaleTerminalSessions();
}

export function cleanupRunningSessionsOnStartup(): number {
  return repository.cleanupRunningSessionsOnStartup();
}
