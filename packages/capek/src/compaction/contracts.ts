/**
 * C6 compaction contracts: the data shapes the compaction service and task
 * pipeline consume. The `CompactionPolicy` data interface keeps its exact
 * pre-C6 identity; `core/compaction.ts` re-exports these types so the compat
 * barrel, `core/agent.ts`, and every existing consumer keep working.
 */

import type { AssistantMessage, TextPart } from '@capekai/types';

/** Compaction trigger reasons */
export type CompactionTriggerReason = 'manual' | 'auto' | 'overflow';

/**
 * Compaction policy for configuring summary generation.
 * All model/provider fields are optional - null means "use session/default".
 * Pruning fields control which tool outputs get marked as compacted.
 * Auto-threshold fields control the hybrid formula for pre-overflow compaction.
 */
export interface CompactionPolicy {
  modelId: string | null;
  providerId: string | null;
  maxOutputTokens: number;
  overflowThresholdRatio: number | null;
  // WS4: Budget-aware pruning knobs
  preserveRecentToolCount: number;
  preserveSmallToolChars: number;
  toolClearCharsThreshold: number;
  maxPrunedToolCount: number;
  // Hybrid formula for auto-compaction threshold
  autoThresholdRatio: number;
  autoReserveCapTokens: number;
  autoSafetyMarginTokens: number;
}

/**
 * Trigger created before compaction.
 * The trigger is a user message with a standard CompactionPart.
 */
export interface CompactionTrigger {
  messageId: string;
  reason: CompactionTriggerReason;
}

/**
 * Compaction task result
 */
export interface CompactionTaskResult {
  trigger: CompactionTrigger;
  summaryMessage: AssistantMessage;
  textParts: TextPart[];
  tokensUsed: {
    prompt: number;
    completion: number;
    cacheRead?: number;
    cacheWrite?: number;
    noCache?: number;
  };
}

/**
 * A function that generates a summary from a prompt.
 * Abstracts away model resolution and the generateText/streamText call.
 */
export interface GenerateSummaryFn {
  (prompt: string, policy: CompactionPolicy, sessionId: string, abortSignal?: AbortSignal): Promise<{
    text: string;
    usage: {
      prompt: number;
      completion: number;
      cacheRead?: number;
      cacheWrite?: number;
      noCache?: number;
    };
    effectiveModelId: string;
    effectiveProviderId: string;
  }>;
}

export interface AutoThresholdResult {
  threshold: number;
  contextWindow: number | undefined;
}
