/**
 * C6 compaction recovery policy. Owns the pre-C6 reconciliation decisions
 * that previously lived in the server store module: skip while compaction is
 * genuinely in flight, clear a stuck compacting flag, and persist one
 * append-only failure per orphaned trigger. The storage queries stay
 * host-provided through `CompactionRecoveryDeps`, so the Capek policy never
 * imports server SQL; the server store module is now a thin compat wiring
 * over this domain.
 */

import type { Message, Session } from '@capekai/types';
import type { BroadcastFn } from '../runtime/host-dependencies';
import { getCompactionService } from './policy';
import { persistCompactionFailure } from './task';

/** Inward-facing storage port the host (the current Jean2 server store)
 * fulfills. Shapes are SDK structural copies; no SQL crosses the boundary. */
export interface CompactionRecoveryDeps {
  /** True when the session's compacting flag is set (a stuck state). */
  isSessionCompacting(sessionId: string): boolean;
  /** Clears the stuck compacting flag and returns the updated session, or
   * null when the session no longer exists. */
  clearSessionCompacting(sessionId: string): Session | null;
  /** Orphaned compaction triggers: user messages with a compaction part and
   * no assistant outcome (assistant message with parentId pointing at it). */
  listOrphanedCompactionTriggers(sessionId: string): Message[];
  /** All session ids for startup-wide reconciliation. */
  listSessionIds(): string[];
  /** Broadcasts runtime events for the persisted failure records. */
  broadcast: BroadcastFn;
  /** Broadcasts session updates after clearing the stuck flag. */
  broadcastSessionUpdated(session: Session): void;
}

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
export async function reconcileSessionCompaction(
  sessionId: string,
  deps: CompactionRecoveryDeps,
  options: ReconcileOptions = {},
): Promise<number> {
  const { broadcast = true } = options;
  const broadcastFn: BroadcastFn = broadcast ? deps.broadcast : () => {};
  const broadcastSessUpdate = broadcast ? deps.broadcastSessionUpdated : () => {};

  // If compaction is genuinely in-flight (tracked in-memory), skip reconciliation entirely.
  // This prevents false "Compaction interrupted" failures when the user switches sessions
  // while compaction is still running on the server.
  if (getCompactionService().isCompactionActive(sessionId)) {
    return 0;
  }

  // Always clear the compacting flag - it's stuck if we're recovering
  if (deps.isSessionCompacting(sessionId)) {
    const session = deps.clearSessionCompacting(sessionId);
    if (broadcast && session) {
      broadcastSessUpdate(session);
    }
  }

  // Find orphaned triggers
  const orphanedTriggers = deps.listOrphanedCompactionTriggers(sessionId);
  const count = orphanedTriggers.length;

  if (count === 0) {
    return 0;
  }

  // Persist failure for each orphaned trigger
  for (const trigger of orphanedTriggers) {
    // Idempotent: once persisted, the failure message becomes the outcome,
    // so the orphan query (NOT EXISTS outcome.parent_id) stops matching.
    await persistCompactionFailure(
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
export async function reconcileAllSessionsCompaction(deps: CompactionRecoveryDeps): Promise<number> {
  const sessionIds = new Set(deps.listSessionIds());

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
    totalReconciled += await reconcileSessionCompaction(sessionId, deps, { broadcast: false });
  }

  console.log(
    `[compaction-recovery] Startup recovery complete: ${totalReconciled} orphaned trigger(s) reconciled`,
  );

  return totalReconciled;
}
