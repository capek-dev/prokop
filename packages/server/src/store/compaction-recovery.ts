/**
 * S5 compat wiring for compaction recovery. The reconciliation decisions
 * (in-flight skip, stuck-flag clearing, orphan-to-failure persistence) moved
 * to the Capek compaction domain in C6 step 2; this store module keeps every
 * pre-slice export identity and only wires the inward-facing
 * `CompactionRecoveryPort` over the current store queries plus the transport
 * broadcast adapters. The store -> compat -> domain path stays temporary
 * until S6/S8 retire it.
 */

import {
  reconcileAllSessionsCompactionWithDeps as reconcileAllSessionsWithDeps,
  reconcileSessionCompactionWithDeps as reconcileSessionWithDeps,
  type CompactionRecoveryDeps,
  type RuntimeEventSink,
} from '@capekai/core/compat/jean2';
import type { CompactionRecoveryPort } from '@/application/ports/session';
import { mapCapekEventToServerMessage } from '@/capek-event-adapter';
import {
  broadcastEvent,
  broadcastSessionUpdated,
  type BroadcastSessionFn,
} from '@/core/broadcast';
import { findOrphanedCompactionTriggers } from './messages';
import { getSession, listSessions, updateSession } from './sessions';

/** Exact pre-slice options shape. The domain's deps-based entrypoints take
 * the structurally identical options; this local declaration keeps the old
 * store export identity instead of re-exporting a new compat-barrel type. */
export interface ReconcileOptions {
  /**
   * When false, skips broadcasting session.updated after clearing the compacting
   * flag. Use this at startup before the broadcast callback is registered.
   * @default true
   */
  broadcast?: boolean;
}

/** Wires the inward-facing compaction recovery port over the current store
 * queries and the transport broadcast adapters. */
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

/**
 * Reconcile a single session's compaction state. The decision logic lives in
 * the Capek compaction domain; this wiring preserves the exact pre-slice
 * signature and default options.
 */
export function reconcileSessionCompaction(
  sessionId: string,
  options: ReconcileOptions = {},
): number {
  return reconcileSessionWithDeps(sessionId, buildCompactionRecoveryDeps(), options);
}

/**
 * Run one-shot recovery across all sessions at startup. The decision logic
 * lives in the Capek compaction domain; the startup path disables
 * broadcasting inside the domain exactly like the pre-slice implementation.
 */
export function reconcileAllSessionsCompaction(): number {
  return reconcileAllSessionsWithDeps(buildCompactionRecoveryDeps());
}
