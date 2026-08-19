/**
 * C6 compaction executor. The pre-C6 module-global active-session set is
 * replaced by scope-owned state: every guard and state transition resolves
 * through `getCompactionService()`, so composed agent scopes hold isolated
 * concurrency guards and unscoped consumers keep the process-default
 * behavior.
 */

import { getModelsConfig } from '../configuration/runtime';
import {
  emitRuntimeEvent,
  emitSessionUpdated,
} from '../runtime/host-dependencies';
import { getMessageWithParts, getSession, updateSession } from '../storage/runtime';
import type { BroadcastFn, BroadcastSessionFn } from '../runtime/host';
import type { CompactionTriggerReason, GenerateSummaryFn } from './contracts';
import { getCompactionService } from './policy';
import {
  createCompactionTrigger,
  persistCompactionFailure,
  processCompactionTask,
} from './task';

export interface CompactionExecutorResult {
  ok: true;
  result: {
    tokensUsed: {
      prompt: number;
      completion: number;
      cacheRead?: number;
      cacheWrite?: number;
      noCache?: number;
    };
    summaryMessageId: string;
    textParts: Array<{ id: string; messageId: string; createdAt: number; type: string; text: string }>;
  };
  triggerMessageId: string;
  reason: CompactionTriggerReason;
}

export interface CompactionExecutorError {
  ok: false;
  error: string;
  triggerMessageId: string | null;
  reason: CompactionTriggerReason;
  skipped: boolean;
}

export function isCompactionActive(sessionId: string): boolean {
  return getCompactionService().isCompactionActive(sessionId);
}

export async function executeCompaction(
  sessionId: string,
  reason: CompactionTriggerReason,
  broadcast: BroadcastFn = emitRuntimeEvent,
  broadcastSessUpdate: BroadcastSessionFn = emitSessionUpdated,
  abortSignal?: AbortSignal,
  /** Additive test/injection seam mirroring `processCompactionTask`'s own
   * generateSummaryFn parameter. Production callers pass at most five
   * arguments exactly like before; focused tests inject a deterministic
   * summary generator to pin abort and failure behavior without a real
   * model call. */
  generateSummaryFn?: GenerateSummaryFn,
): Promise<CompactionExecutorResult | CompactionExecutorError> {
  const service = getCompactionService();
  if (service.isCompactionActive(sessionId)) {
    return {
      ok: false,
      error: 'Compaction is already in progress for this session',
      triggerMessageId: null,
      reason,
      skipped: true,
    };
  }

  let triggerMessageId: string | null = null;
  const session = await getSession(sessionId);
  if (!session || session.parentId) {
    return {
      ok: false,
      error: 'Compaction is only available for main sessions',
      triggerMessageId: null,
      reason,
      skipped: true,
    };
  }

  // C6 step 6: mandatory concurrency gate backed by the persisted session
  // flag. The flag is written by this executor and cleared by recovery, so
  // a custom policy service whose in-memory guard is broken still cannot
  // start a second compaction for the same session.
  //
  // Honest limitation (pre-existing, preserved): the persisted flag guards
  // single-process exclusivity plus recovery. A second OS process writing
  // the same database directly can still race the flag (check-then-set
  // TOCTOU); SQLite locking is out of C6 scope.
  if (session.compacting) {
    return {
      ok: false,
      error: 'Compaction is already in progress for this session',
      triggerMessageId: null,
      reason,
      skipped: true,
    };
  }

  const config = getModelsConfig();
  const policy = service.resolvePolicy(
    session.selectedModel || config.defaultModel,
    session.selectedProvider || config.defaultProvider,
  );

  service.beginCompaction(sessionId);
  const compactingSession = await updateSession(sessionId, { compacting: true });
  if (compactingSession) broadcastSessUpdate(compactingSession);

  try {
    const trigger = await createCompactionTrigger(sessionId, reason);
    triggerMessageId = trigger.messageId;
    const triggerMsg = await getMessageWithParts(trigger.messageId);
    if (triggerMsg) {
      broadcast({ kind: 'message', action: 'created', message: triggerMsg.message });
      for (const part of triggerMsg.parts) broadcast({ kind: 'part', action: 'created', sessionId, part });
    }

    const result = await processCompactionTask(sessionId, trigger.messageId, policy, generateSummaryFn, abortSignal);
    broadcast({ kind: 'message', action: 'created', message: result.summaryMessage });
    for (const part of result.textParts) broadcast({ kind: 'part', action: 'created', sessionId, part });

    const completedSession = await updateSession(sessionId, {
      promptTokens: result.tokensUsed.prompt,
      completionTokens: result.tokensUsed.completion,
      totalTokens: result.tokensUsed.prompt + result.tokensUsed.completion,
      cacheReadTokens: result.tokensUsed.cacheRead ?? 0,
      cacheWriteTokens: result.tokensUsed.cacheWrite ?? 0,
      noCacheTokens: result.tokensUsed.noCache ?? 0,
      compacting: false,
    });
    if (completedSession) broadcastSessUpdate(completedSession);

    return {
      ok: true,
      result: {
        tokensUsed: result.tokensUsed,
        summaryMessageId: result.summaryMessage.id,
        textParts: result.textParts,
      },
      triggerMessageId,
      reason,
    };
  } catch (err: unknown) {
    const updatedSession = await updateSession(sessionId, { compacting: false });
    if (updatedSession) broadcastSessUpdate(updatedSession);
    const errorMessage = err instanceof Error ? err.message : 'Compaction failed';
    if (triggerMessageId) await persistCompactionFailure(sessionId, triggerMessageId, errorMessage, broadcast);
    return { ok: false, error: errorMessage, triggerMessageId, reason, skipped: false };
  } finally {
    service.endCompaction(sessionId);
  }
}
