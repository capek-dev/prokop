/**
 * Jean2 terminal session port adapter (S5 PTY/terminal persistence
 * isolation). Fills the inward-facing `TerminalSessionStorePort` with the
 * SQLite terminal session repository over the current store database
 * accessor.
 */

import { getDatabase } from '@/store';
import { createTerminalSessionRepository } from '@/infrastructure/sqlite/terminal-session-repository';
import type { TerminalSessionStorePort } from '@/application/ports/terminal';

export function createJean2TerminalSessionPort(): TerminalSessionStorePort {
  return createTerminalSessionRepository(() => getDatabase());
}
