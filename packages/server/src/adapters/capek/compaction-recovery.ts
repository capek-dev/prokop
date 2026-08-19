/**
 * Wires Capek compaction recovery to Jean2's SQLite repositories and server
 * broadcast adapters. Reconciliation decisions remain in the Capek domain.
 */

import {
  reconcileAllSessionsCompactionWithDeps as reconcileAllSessionsWithDeps,
  reconcileSessionCompactionWithDeps as reconcileSessionWithDeps,
  type CompactionRecoveryDeps,
  type RuntimeEventSink,
} from '@capekai/core/execution';
import type { CompactionRecoveryPort } from '@/application/ports/session';
import { mapCapekEventToServerMessage } from '@/adapters/capek/events';
import {
  broadcastEvent,
  broadcastSessionUpdated,
  type BroadcastSessionFn,
} from '@/transport/websocket/broadcast';
import { findOrphanedCompactionTriggers } from '@/infrastructure/sqlite/message-store';
import { getSession, listSessions, updateSession } from '@/infrastructure/sqlite/session-store';

export interface ReconcileOptions {
  broadcast?: boolean;
}

function buildCompactionRecoveryDeps(): CompactionRecoveryDeps & CompactionRecoveryPort {
  const broadcastFn: RuntimeEventSink = (event) => {
    const message = mapCapekEventToServerMessage(event);
    if (message) broadcastEvent(message);
  };
  const broadcastSessUpdate: BroadcastSessionFn = broadcastSessionUpdated;

  return {
    isSessionCompacting(sessionId: string): boolean {
      return getSession(sessionId)?.compacting === true;
    },
    clearSessionCompacting(sessionId: string) {
      updateSession(sessionId, { compacting: false });
      return getSession(sessionId);
    },
    listOrphanedCompactionTriggers(sessionId: string) {
      return findOrphanedCompactionTriggers(sessionId);
    },
    listSessionIds(): string[] {
      return listSessions().map((session) => session.id);
    },
    broadcast: broadcastFn,
    broadcastSessionUpdated: broadcastSessUpdate,
  };
}

export function reconcileSessionCompaction(
  sessionId: string,
  options: ReconcileOptions = {},
): number {
  return reconcileSessionWithDeps(sessionId, buildCompactionRecoveryDeps(), options);
}

export function reconcileAllSessionsCompaction(): number {
  return reconcileAllSessionsWithDeps(buildCompactionRecoveryDeps());
}
