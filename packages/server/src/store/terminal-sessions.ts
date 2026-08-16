/**
 * Terminal session store compat forwarder (S5 PTY/terminal persistence
 * isolation). Keeps every pre-slice export identity; SQL and row mapping
 * now live in `infrastructure/sqlite/terminal-session-repository.ts`. The
 * startup and stale cleanup behavior is exactly the pre-slice one, delegated
 * through the repository over the current store database accessor.
 */

import { getDatabase } from './index';
import { createTerminalSessionRepository } from '@/infrastructure/sqlite/terminal-session-repository';
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
