import type { ManagedWorktree, Session } from '@prokopai/sdk';
import { resolveSessionWorktree } from '@/lib/sessionWorktree';

export interface SessionCheckoutGroup {
  /** Worktree id, or null for the workspace's main checkout. */
  worktreeId: string | null;
  name: string;
  available: boolean;
  sessions: Session[];
}

export const MAIN_CHECKOUT_NAME = 'Main checkout';

/**
 * Groups sessions by the checkout they run in. The main checkout comes first;
 * worktrees follow in the order of their most recent session, and sessions
 * keep their list order inside each group.
 */
export function groupSessionsByCheckout(sessions: Session[], worktrees: ManagedWorktree[]): SessionCheckoutGroup[] {
  const main: SessionCheckoutGroup = { worktreeId: null, name: MAIN_CHECKOUT_NAME, available: true, sessions: [] };
  const byWorktree = new Map<string, SessionCheckoutGroup>();

  for (const session of sessions) {
    const worktreeId = session.workspaceRootId ?? null;
    if (!worktreeId) {
      main.sessions.push(session);
      continue;
    }
    let group = byWorktree.get(worktreeId);
    if (!group) {
      const worktree = resolveSessionWorktree(worktreeId, session.worktree, worktrees);
      group = {
        worktreeId,
        name: worktree?.name ?? 'Worktree',
        available: worktree?.state === 'available',
        sessions: [],
      };
      byWorktree.set(worktreeId, group);
    }
    group.sessions.push(session);
  }

  return [...(main.sessions.length > 0 ? [main] : []), ...byWorktree.values()];
}
