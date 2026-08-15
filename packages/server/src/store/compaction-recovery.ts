/**
 * Compaction Recovery Module (Workstream 2)
 *
 * Provides recovery logic for orphaned compaction triggers and stuck compacting flags.
 * This runs at startup and on session resume to ensure consistent state after crashes.
 */

import { getDatabase } from './index';
import { updateSession, getSession } from './sessions';
import { findOrphanedCompactionTriggers } from './messages';
import type { RuntimeEventSink } from '@capekai/core/compat/jean2';
import { mapCapekEventToServerMessage } from '@/capek-event-adapter';
import { persistCompactionFailure } from '@capekai/core/compat/jean2';
import { broadcastEvent, broadcastSessionUpdated, type BroadcastSessionFn } from '@/core/broadcast';
import { isCompactionActive } from '@capekai/core/compat/jean2';

export interface ReconcileOptions {
  /**
   * When false, skips broadcasting session.updated after clearing the compacting
   * flag. Use this at startup before the broadcast callback is registered.
   * @default true
   */
  broadcast?: boolean;
}

/**
 * Reconcile a single session's compaction state.
 *
 * This function:
 * 1. Finds orphaned compaction triggers (triggers without any outcome)
 * 2. Persists failure records for each orphaned trigger (idempotent)
 * 3. Clears the compacting flag if set
 *
 * Returns the number of orphaned triggers reconciled.
 */
export function reconcileSessionCompaction(sessionId: string, options: ReconcileOptions = {}): number {
  const { broadcast = true } = options;
  const db = getDatabase();

  const broadcastFn: RuntimeEventSink = broadcast
    ? (event) => {
      const message = mapCapekEventToServerMessage(event);
      if (message) broadcastEvent(message);
    }
    : () => {};
  const broadcastSessUpdate: BroadcastSessionFn = broadcast
    ? broadcastSessionUpdated
    : () => {};

  // If compaction is genuinely in-flight (tracked in-memory), skip reconciliation entirely.
  // This prevents false "Compaction interrupted" failures when the user switches sessions
  // while compaction is still running on the server.
  if (isCompactionActive(sessionId)) {
    return 0;
  }

  // Always clear the compacting flag - it's stuck if we're recovering
  const sessionRow = db
    .query('SELECT compacting FROM sessions WHERE id = ?')
    .get(sessionId) as { compacting: number } | undefined;

  if (sessionRow?.compacting) {
    updateSession(sessionId, { compacting: false });
    // Use getSession() for a properly-shaped payload instead of a raw row cast
    if (broadcast) {
      const session = getSession(sessionId);
      if (session) {
        broadcastSessUpdate(session);
      }
    }
  }

  // Find orphaned triggers
  const orphanedTriggers = findOrphanedCompactionTriggers(sessionId);
  const count = orphanedTriggers.length;

  if (count === 0) {
    return 0;
  }

  // Persist failure for each orphaned trigger
  for (const trigger of orphanedTriggers) {
    // Idempotent: once persisted, the failure message becomes the outcome,
    // so the orphan query (NOT EXISTS outcome.parent_id) stops matching.
    persistCompactionFailure(
      sessionId,
      trigger.id,
      'Compaction interrupted (session recovered after crash or interruption)',
      broadcastFn,
    );
  }

  console.log(
    `[compaction-recovery] Reconciled ${count} orphaned trigger(s) for session ${sessionId}`,
  );

  return count;
}

/**
 * Run one-shot recovery across all sessions at startup.
 *
 * This scans all sessions to find orphaned compaction triggers (user messages
 * with a compaction part that have no outcome). Once persisted, the failure
 * message becomes the outcome, so the orphan query stops matching.
 *
 * Returns total count of orphaned triggers reconciled.
 */
export function reconcileAllSessionsCompaction(): number {
  const db = getDatabase();

  // Scan all sessions - orphaned triggers can exist even when compacting=false
  // and there are no parent_id messages yet (crash before first reply).
  const allSessions = db.query('SELECT id FROM sessions').all() as { id: string }[];
  const sessionIds = new Set(allSessions.map((row) => row.id));

  if (sessionIds.size === 0) {
    console.log('[compaction-recovery] No sessions requiring compaction reconciliation found');
    return 0;
  }

  console.log(
    `[compaction-recovery] Reconciling ${sessionIds.size} session(s) for compaction state`,
  );

  let totalReconciled = 0;

  // Startup path: disable broadcasting since the broadcast callback may not
  // be registered yet when this runs at server startup.
  for (const sessionId of sessionIds) {
    totalReconciled += reconcileSessionCompaction(sessionId, { broadcast: false });
  }

  console.log(
    `[compaction-recovery] Startup recovery complete: ${totalReconciled} orphaned trigger(s) reconciled`,
  );

  return totalReconciled;
}
