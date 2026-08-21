import type { Session } from '@prokopai/sdk';

/**
 * Deduplicate sessions by ID, keeping the last occurrence (most recent page).
 * Sort by server order: updatedAt DESC, id DESC.
 */
export function dedupeAndSortSessions(sessions: Session[]): Session[] {
  const byId = new Map<string, Session>();
  for (const session of sessions) {
    byId.set(session.id, session);
  }
  return [...byId.values()].sort((a, b) => {
    const tsA = new Date(a.updatedAt).getTime();
    const tsB = new Date(b.updatedAt).getTime();
    if (tsB !== tsA) return tsB - tsA;
    return b.id.localeCompare(a.id);
  });
}
