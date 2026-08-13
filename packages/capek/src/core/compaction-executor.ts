import {
  broadcastEvent,
  broadcastSessionUpdated,
} from '../compat/jean2-dependencies';
import { getModelsConfig } from '../configuration/runtime';
import { getMessageWithParts, getSession, updateSession } from '../storage/runtime';
import type { BroadcastFn, BroadcastSessionFn } from '../compat/bindings';
import {
  createCompactionTrigger,
  persistCompactionFailure,
  processCompactionTask,
  resolveCompactionPolicy,
  type CompactionTriggerReason,
} from './compaction';

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

const activeCompactionSessions = new Set<string>();

export function isCompactionActive(sessionId: string): boolean {
  return activeCompactionSessions.has(sessionId);
}

export async function executeCompaction(
  sessionId: string,
  reason: CompactionTriggerReason,
  broadcast: BroadcastFn = broadcastEvent,
  broadcastSessUpdate: BroadcastSessionFn = broadcastSessionUpdated,
): Promise<CompactionExecutorResult | CompactionExecutorError> {
  if (activeCompactionSessions.has(sessionId)) {
    return {
      ok: false,
      error: 'Compaction is already in progress for this session',
      triggerMessageId: null,
      reason,
      skipped: true,
    };
  }

  let triggerMessageId: string | null = null;
  const session = getSession(sessionId);
  if (!session || session.parentId) {
    return {
      ok: false,
      error: 'Compaction is only available for main sessions',
      triggerMessageId: null,
      reason,
      skipped: true,
    };
  }

  const config = getModelsConfig();
  const policy = resolveCompactionPolicy(
    session.selectedModel || config.defaultModel,
    session.selectedProvider || config.defaultProvider,
  );

  activeCompactionSessions.add(sessionId);
  const compactingSession = updateSession(sessionId, { compacting: true });
  if (compactingSession) broadcastSessUpdate(compactingSession);

  try {
    const trigger = createCompactionTrigger(sessionId, reason);
    triggerMessageId = trigger.messageId;
    const triggerMsg = getMessageWithParts(trigger.messageId);
    if (triggerMsg) {
      broadcast({ type: 'message.created', message: triggerMsg.message });
      for (const part of triggerMsg.parts) broadcast({ type: 'part.created', sessionId, part });
    }

    const result = await processCompactionTask(sessionId, trigger.messageId, policy);
    broadcast({ type: 'message.created', message: result.summaryMessage });
    for (const part of result.textParts) broadcast({ type: 'part.created', sessionId, part });

    const completedSession = updateSession(sessionId, {
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
    const updatedSession = updateSession(sessionId, { compacting: false });
    if (updatedSession) broadcastSessUpdate(updatedSession);
    const errorMessage = err instanceof Error ? err.message : 'Compaction failed';
    if (triggerMessageId) persistCompactionFailure(sessionId, triggerMessageId, errorMessage, broadcast);
    return { ok: false, error: errorMessage, triggerMessageId, reason, skipped: false };
  } finally {
    activeCompactionSessions.delete(sessionId);
  }
}
