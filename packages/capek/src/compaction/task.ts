/**
 * C6 compaction task pipeline: trigger creation, conversation text, summary
 * generation, budget-aware pruning, and failure persistence. All behavior is
 * moved verbatim from the pre-C6 `core/compaction.ts`; the safety invariants
 * (minimum-message validation, trigger validation, boundary validation, and
 * the main-session requirement enforced by the executor) stay hard errors
 * and are not configurable.
 *
 * Named core edges (AST-gated by `compaction-domain-no-core`): model
 * construction (`core/model-utils`) and provider discovery
 * (`core/provider-utils`) stay in core until C7.
 */

import { streamText as aiStreamText } from 'ai';
import { randomUUID } from 'crypto';
import type {
  AssistantMessage, CompactionPart, MessageWithParts, TextPart, ToolPart } from '@capekai/types';
import { getModelWithMetadata } from '../core/model-utils';
import { findProviderFromModel } from '../core/provider-utils';
import { getModelsConfig } from '../configuration/runtime';
import { emitRuntimeEvent, type BroadcastFn } from '../runtime/host-dependencies';
import {
  buildEffectiveContextHistory,
  createMessage,
  createPart,
  getPartsBySession,
  listMessagesWithParts,
  updatePart,
} from '../storage/runtime';
import type {
  CompactionPolicy,
  CompactionTrigger,
  CompactionTriggerReason,
  CompactionTaskResult,
  GenerateSummaryFn,
} from './contracts';

const COMPACTION_PROMPT_FIRST = `Summarize the following conversation for context continuity.

Structure your response with these sections:
- **Decisions**: Key choices made and rationale
- **Changes**: Files/functions created or modified (with paths)
- **Context**: Important state, configurations, or patterns established
- **Open items**: Unresolved issues or planned next steps

Be specific with file paths, function names, and technical details.

Conversation to summarize:

{CONVERSATION}`;

const COMPACTION_PROMPT_INCREMENTAL = `The following is a previous conversation summary, followed by new messages since that summary.

Produce an UPDATED summary that incorporates the new information. Keep it concise and structured.

Structure your response with these sections:
- **Decisions**: Key choices made and rationale
- **Changes**: Files/functions created or modified (with paths)
- **Context**: Important state, configurations, or patterns established
- **Open items**: Unresolved issues or planned next steps

Previous summary:
{PREVIOUS_SUMMARY}

New messages since that summary:
{CONVERSATION}`;

/**
 * Creates a compaction trigger message and returns it.
 * The trigger is persisted to the database as a user message with a standard CompactionPart.
 */
export async function createCompactionTrigger(
  sessionId: string,
  reason: CompactionTriggerReason,
): Promise<CompactionTrigger> {
  // Minimum validation: at least 1 user + 1 assistant message needed for meaningful compaction.
  // A single agent turn with heavy tool use can produce enough context to warrant compaction.
  const { messages: effectiveHistory } = await buildEffectiveContextHistory(sessionId);
  const nonSystemCount = effectiveHistory.filter(
    (m: MessageWithParts) => m.message.role !== 'system',
  ).length;

  if (nonSystemCount < 2) {
    throw new Error('Not enough messages for compaction (need at least a user and assistant turn)');
  }

  const triggerMessageId = randomUUID();
  const now = Date.now();

  // Create a trigger message (user role to indicate it came from the user/system)
  const triggerMessage = {
    id: triggerMessageId,
    sessionId,
    role: 'user' as const,
    createdAt: now,
  };

  await createMessage(triggerMessage);

  // Create a standard CompactionPart (metadata-only per spec)
  const compactionPart: CompactionPart = {
    id: randomUUID(),
    messageId: triggerMessageId,
    createdAt: now,
    type: 'compaction',
    auto: reason !== 'manual',
    overflow: reason === 'overflow',
  };

  await createPart(compactionPart, sessionId);

  return {
    messageId: triggerMessageId,
    reason,
  };
}

export function buildConversationText(messages: MessageWithParts[]): string {
  const lines: string[] = [];

  for (const { message, parts } of messages) {
    if (message.role === 'system') continue;

    lines.push(`\n--- ${message.role.toUpperCase()} ---`);

    for (const part of parts) {
      if (part.type === 'text') {
        lines.push((part as { text: string }).text);
      } else if (part.type === 'tool') {
        const toolPart = part as {
          name: string;
          state: { input: unknown; output?: unknown; status: string; error?: string };
        };
        lines.push(`\n[TOOL: ${toolPart.name}]`);
        lines.push(`Input: ${JSON.stringify(toolPart.state.input, null, 2)}`);
        if (toolPart.state.status === 'completed') {
          lines.push(`Output: ${formatOutput(toolPart.state.output)}`);
        } else if (toolPart.state.status === 'error') {
          lines.push(`Error: ${toolPart.state.error}`);
        }
      }
    }
  }

  return lines.join('\n');
}

export function formatOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output.length > 500
      ? output.slice(0, 500) + '...(truncated)'
      : output;
  }
  const str = JSON.stringify(output, null, 2);
  return str.length > 500 ? str.slice(0, 500) + '...(truncated)' : str;
}

/**
 * Estimate the character size of a tool's output.
 * Uses cheap serialization - no need for accurate tokenization here.
 */
export function estimateToolOutputSize(output: unknown): number {
  if (output === null || output === undefined) {
    return 0;
  }
  if (typeof output === 'string') {
    return output.length;
  }
  // For objects/arrays, serialize to JSON and measure
  try {
    return JSON.stringify(output).length;
  } catch {
    return 0;
  }
}

/**
 * Mark tool results as compacted after a successful compaction.
 * WS4: Budget-aware pruning - selectively marks tools based on policy.
 *
 * Pruning strategy:
 * 1. Always protect 'skill' tool outputs
 * 2. Protect small outputs (below preserveSmallToolChars)
 * 3. Protect the N most recent eligible tools (preserveRecentToolCount)
 * 4. Clear older/larger outputs that exceed toolClearCharsThreshold
 * 5. Respect maxPrunedToolCount limit
 *
 * This preserves important recent context while still reducing context size
 * for older, larger tool outputs that are less likely to be relevant.
 */
async function markToolsAsCompacted(
  sessionId: string,
  compactedMessageIds: string[],
  policy: CompactionPolicy,
): Promise<void> {
  const allParts = await getPartsBySession(sessionId);
  const now = Date.now();

  // Gather eligible completed tool parts within compacted messages
  const eligibleTools: Array<{
    part: ToolPart;
    outputSize: number;
    createdAt: number;
  }> = [];

  for (const part of allParts) {
    if (part.type !== 'tool') continue;

    const toolPart = part as ToolPart;

    // Skip non-completed tools
    if (toolPart.state.status !== 'completed') continue;

    // Skip tools not in compacted messages
    if (!compactedMessageIds.includes(toolPart.messageId)) continue;

    // Always protect skill tool outputs
    if (toolPart.name === 'skill') continue;

    // Estimate output size
    const outputSize = estimateToolOutputSize((toolPart.state as { output?: unknown }).output);

    // Protect small outputs below threshold
    if (outputSize <= policy.preserveSmallToolChars) continue;

    eligibleTools.push({
      part: toolPart,
      outputSize,
      createdAt: part.createdAt,
    });
  }

  // Sort by createdAt descending (most recent first)
  eligibleTools.sort((a, b) => b.createdAt - a.createdAt);

  // Skip the N most recent eligible tools (preserveRecentToolCount) - they stay protected.
  // The remainder (older tools) become candidates for pruning.
  // Process candidates from oldest to newest to be conservative about what gets cleared.
  const candidatesForPruning = eligibleTools
    .slice(policy.preserveRecentToolCount)
    .sort((a, b) => a.createdAt - b.createdAt);

  // Apply maxPrunedToolCount limit - only prune up to this many tools
  const toolsToPrune = candidatesForPruning.slice(0, policy.maxPrunedToolCount);

  // Mark older/larger tools as compacted
  for (const candidate of toolsToPrune) {
    // Only clear tools that exceed the clear threshold
    // (already know they exceed preserveSmallToolChars since we filtered above)
    if (candidate.outputSize > policy.toolClearCharsThreshold) {
      await updatePart(candidate.part.id, {
        state: {
          ...candidate.part.state,
          compactedAt: now,
        },
      });
    }
  }
}

/**
 * Default implementation that uses AI SDK streamText.
 * Uses streamText universally; required for providers like Codex/OpenAI
 * Responses API that reject non-streaming calls.
 */
async function defaultGenerateSummary(
  prompt: string,
  policy: CompactionPolicy,
  sessionId: string,
  abortSignal?: AbortSignal,
): Promise<{
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
}> {
  const { model, omitMaxOutputTokens, providerOptions } = await getModelWithMetadata({
    modelId: policy.modelId ?? undefined,
    providerId: policy.providerId ?? undefined,
    systemPrompt: prompt,
    sessionId,
  });

  const effectiveModelId = policy.modelId || getModelsConfig().defaultModel;
  let effectiveProviderId = policy.providerId;
  if (!effectiveProviderId) {
    effectiveProviderId = findProviderFromModel(effectiveModelId);
  }

  const stream = aiStreamText({
    model,
    prompt,
    abortSignal,
    maxOutputTokens: omitMaxOutputTokens ? undefined : policy.maxOutputTokens,
    providerOptions: providerOptions as unknown as Parameters<typeof aiStreamText>[0]['providerOptions'],
  });

  let text: string;
  try {
    text = await stream.text;
  } catch (err) {
    console.error('[compaction] streamText failed:', err);
    throw err;
  }

  const streamUsage = await stream.usage;
  const streamFinishReason = await stream.finishReason;

  if (streamFinishReason === 'length') {
    console.warn('[compaction] Summary was truncated (hit maxOutputTokens limit). Some context may be lost.');
    text += '\n\n[Note: Summary was truncated due to token limit. Some context may be incomplete.]';
  }

  return {
    text,
    usage: {
      prompt: streamUsage.inputTokens ?? 0,
      completion: streamUsage.outputTokens ?? 0,
      cacheRead: streamUsage.inputTokenDetails.cacheReadTokens ?? 0,
      cacheWrite: streamUsage.inputTokenDetails.cacheWriteTokens ?? 0,
      noCache: streamUsage.inputTokenDetails.noCacheTokens ?? 0,
    },
    effectiveModelId,
    effectiveProviderId,
  };
}

/**
 * Processes a compaction task from a trigger message.
 * Creates an assistant message with the summary text.
 */
export async function processCompactionTask(
  sessionId: string,
  triggerMessageId: string,
  policy: CompactionPolicy,
  generateSummaryFn?: GenerateSummaryFn,
  abortSignal?: AbortSignal,
): Promise<CompactionTaskResult> {
  // Get the trigger message
  const allMessages = await listMessagesWithParts(sessionId);
  const triggerMsgWithParts = allMessages.find((m: MessageWithParts) => m.message.id === triggerMessageId);

  if (!triggerMsgWithParts) {
    throw new Error('Trigger message not found');
  }

  // Get the CompactionPart to determine reason
  const triggerPart = triggerMsgWithParts.parts.find((p: MessageWithParts['parts'][number]) => p.type === 'compaction');
  if (!triggerPart) {
    throw new Error('Trigger message does not have a compaction part');
  }

  const compactionPart = triggerPart as CompactionPart;
  const reason: CompactionTriggerReason = compactionPart.overflow
    ? 'overflow'
    : compactionPart.auto
      ? 'auto'
      : 'manual';

  // Get the trigger message's boundary (all messages before the trigger)
  // Find the index of the trigger in the full session history
  const triggerIdx = allMessages.findIndex((m: MessageWithParts) => m.message.id === triggerMessageId);

  // Check for a previous compaction summary BEFORE the trigger to avoid re-summarizing
  // already-compactored content. When a previous summary exists, only compact messages
  // AFTER the summary. This prevents re-sending the entire pre-compaction history to the
  // LLM, which is especially important for forked sessions that inherit compaction artifacts.
  let previousSummaryText: string | null = null;
  let compactStartIdx = 0;

  for (let i = triggerIdx - 1; i >= 0; i--) {
    const m = allMessages[i];
    if (
      m.message.role === 'assistant' &&
      (m.message as AssistantMessage).summary === true &&
      (m.message as AssistantMessage).mode === 'compaction'
    ) {
      // Extract text from the summary
      const textParts = m.parts.filter((p: MessageWithParts['parts'][number]) => p.type === 'text');
      if (textParts.length > 0) {
        previousSummaryText = textParts.map((p: MessageWithParts['parts'][number]) => (p as { text: string }).text).join('\n');
        compactStartIdx = i + 1;
      }
      break;
    }
  }

  const messagesToCompact = allMessages
    .slice(compactStartIdx, triggerIdx)
    .filter((m: MessageWithParts) => m.message.role !== 'system');

  if (messagesToCompact.length === 0) {
    throw new Error('No messages to compact');
  }

  // Validate: there must be at least one user message to serve as a meaningful boundary.
  // This replaces the fragile hasNestedCompaction guard.
  const hasUserMessage = messagesToCompact.some(
    (m: MessageWithParts) => m.message.role === 'user',
  );
  if (!hasUserMessage) {
    throw new Error('Compaction boundary must contain at least one user message');
  }

  // Build the prompt
  const conversationText = buildConversationText(messagesToCompact);

  const prompt = previousSummaryText
    ? COMPACTION_PROMPT_INCREMENTAL
        .replace('{PREVIOUS_SUMMARY}', previousSummaryText)
        .replace('{CONVERSATION}', conversationText)
    : COMPACTION_PROMPT_FIRST.replace('{CONVERSATION}', conversationText);

  console.log('[compaction] modelId:', policy.modelId, 'providerId:', policy.providerId);

  const generateSummary = generateSummaryFn ?? defaultGenerateSummary;
  const { text: summary, usage, effectiveModelId, effectiveProviderId } = await generateSummary(
    prompt,
    policy,
    sessionId,
    abortSignal,
  );

  const now = Date.now();
  const msgId = randomUUID();

  // Create an assistant message with summary metadata
  // Record the effective model/provider that was actually used for generation
  const assistantMessage: AssistantMessage = {
    id: msgId,
    sessionId,
    role: 'assistant',
    status: 'completed',
    modelId: effectiveModelId,
    providerId: effectiveProviderId,
    tokens: {
      prompt: usage.prompt,
      completion: usage.completion,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      noCache: usage.noCache ?? 0,
    },
    cost: 0,
    summary: true,
    mode: 'compaction',
    parentId: triggerMessageId,
    createdAt: now,
    completedAt: now,
  };

  await createMessage(assistantMessage);

  // Create a text part with the summary content
  const textPartId = randomUUID();
  const textPart: TextPart = {
    id: textPartId,
    messageId: msgId,
    createdAt: now,
    type: 'text',
    text: summary,
  };
  await createPart(textPart, sessionId);

  // Mark tool results as compacted so they can be pruned in future context
  // WS4: Now passes policy for budget-aware pruning
  const compactedMessageIds = messagesToCompact.map((m: MessageWithParts) => m.message.id);
  await markToolsAsCompacted(sessionId, compactedMessageIds, policy);

  const trigger: CompactionTrigger = {
    messageId: triggerMessageId,
    reason,
  };

  return {
    trigger,
    summaryMessage: assistantMessage,
    textParts: [textPart],
    tokensUsed: usage,
  };
}

/**
 * Persist a compaction failure as an append-only assistant message.
 * Creates an assistant message with status='error', mode='compact_failed',
 * parentId pointing to the trigger, and a text part with the error explanation.
 * Broadcasts the failure via standard message/part events.
 *
 * NOTE: This should only be called AFTER a trigger has been created.
 * If validation fails before trigger creation, do not call this function.
 */
export async function persistCompactionFailure(
  sessionId: string,
  triggerMessageId: string,
  errorMessage: string,
  broadcast: BroadcastFn = emitRuntimeEvent,
): Promise<void> {
  const now = Date.now();
  const msgId = randomUUID();

  const assistantMessage: AssistantMessage = {
    id: msgId,
    sessionId,
    role: 'assistant',
    status: 'error',
    modelId: '',
    providerId: '',
    tokens: {
      prompt: 0,
      completion: 0,
    },
    cost: 0,
    mode: 'compact_failed',
    parentId: triggerMessageId,
    createdAt: now,
    completedAt: now,
    error: errorMessage,
  };

  await createMessage(assistantMessage);

  const textPartId = randomUUID();
  const textPart: TextPart = {
    id: textPartId,
    messageId: msgId,
    createdAt: now,
    type: 'text',
    text: `Compaction failed: ${errorMessage}`,
  };

  await createPart(textPart, sessionId);

  broadcast({ kind: 'message', action: 'created', message: assistantMessage });
  broadcast({ kind: 'part', action: 'created', sessionId, part: textPart });
}
