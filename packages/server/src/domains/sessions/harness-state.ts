import type {
  Session,
  SessionHarness,
  SessionHarnessState,
  SessionHarnessGoalState,
  SessionHarnessUsageState,
} from '@prokopai/sdk';

/**
 * Server-side derivation of normalized harness state (S11.6).
 *
 * The harness implementations persist their per-harness state as metadata
 * keys (codexCompactPending, claudeGoal, ...). This module is the single
 * place that knows those keys: storage reads attach the derived
 * `harnessState` to every session they return, and clients consume the
 * normalized fields instead of parsing harness metadata or branching on
 * harness identity.
 */

function codexObject(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
}

function numberOr(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function compactionBoundary(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Codex goal metadata: status, objective, token budget, turns. */
function codexGoalState(metadata: Record<string, unknown>): SessionHarnessGoalState | null {
  const goal = metadata.codexGoal;
  if (!goal || typeof goal !== 'object' || Array.isArray(goal)) return null;
  const record = goal as Record<string, unknown>;
  const status = typeof record.status === 'string' ? record.status : null;
  if (!status) return null;
  const tokensUsed = numberOr(record.tokensUsed);
  const tokenBudget = numberOr(record.tokenBudget);
  const currentTurn = numberOr(record.currentTurn);
  const maxTurns = numberOr(record.maxTurns);
  const progress = tokensUsed !== null
    ? { kind: 'tokens' as const, current: tokensUsed, max: tokenBudget }
    : currentTurn !== null
      ? { kind: 'turns' as const, current: currentTurn, max: maxTurns }
      : null;
  return { status, objective: stringOr(record.objective), progress };
}

/** Claude goal metadata: status, condition, iteration count. */
function claudeGoalState(metadata: Record<string, unknown>): SessionHarnessGoalState | null {
  const goal = metadata.claudeGoal;
  if (!goal || typeof goal !== 'object' || Array.isArray(goal)) return null;
  const record = goal as Record<string, unknown>;
  const status = typeof record.status === 'string' ? record.status : null;
  if (!status) return null;
  const iterations = numberOr(record.iterations) ?? 0;
  return {
    status,
    objective: stringOr(record.condition),
    progress: { kind: 'iterations', current: iterations, max: null },
  };
}

/** Prokop goal comes from the runtime GoalState, not metadata. */
interface UsageSource {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

function formatTokens(value: number): string {
  return value.toLocaleString();
}

/** Codex usage metadata: latest input/output, cumulative totals, context window. */
function codexUsageState(metadata: Record<string, unknown>): SessionHarnessUsageState | null {
  const usage = metadata.codexUsage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const record = usage as Record<string, unknown>;
  const last = record.last && typeof record.last === 'object' && !Array.isArray(record.last)
    ? record.last as Record<string, unknown> : null;
  const total = record.total && typeof record.total === 'object' && !Array.isArray(record.total)
    ? record.total as Record<string, unknown> : null;
  const window = numberOr(record.modelContextWindow) ?? 0;
  if (!last && !total) return null;
  const input = numberOr(last?.inputTokens) ?? 0;
  const output = numberOr(last?.outputTokens) ?? 0;
  const rows: SessionHarnessUsageState['rows'] = [];
  if (last) {
    rows.push({ label: 'Latest input', value: formatTokens(input) });
    rows.push({ label: 'Latest output', value: formatTokens(output) });
    const cached = numberOr(last?.cachedInputTokens);
    if (cached !== null && cached > 0) rows.push({ label: 'Latest cached input', value: formatTokens(cached) });
  }
  if (total) {
    rows.push({ label: 'Thread total', value: formatTokens(numberOr(total.totalTokens) ?? 0) });
  }
  if (window > 0) {
    rows.push({ label: 'Context window', value: formatTokens(window) });
  }
  return { used: window > 0 ? numberOr(last?.totalTokens) ?? 0 : 0, contextWindow: window, rows };
}

/** Claude usage metadata: latest input/output plus context occupancy. */
function claudeUsageState(metadata: Record<string, unknown>): SessionHarnessUsageState | null {
  const usage = metadata.claudeUsage;
  const context = metadata.claudeContext;
  if (!usage && !context) return null;
  const usageRecord = usage && typeof usage === 'object' && !Array.isArray(usage)
    ? usage as Record<string, unknown> : null;
  const lastRecord = usageRecord?.last && typeof usageRecord.last === 'object' && !Array.isArray(usageRecord.last)
    ? usageRecord.last as Record<string, unknown> : null;
  const contextRecord = context && typeof context === 'object' && !Array.isArray(context)
    ? context as Record<string, unknown> : null;
  const prompt = numberOr(lastRecord?.prompt) ?? 0;
  const completion = numberOr(lastRecord?.completion) ?? 0;
  const used = numberOr(contextRecord?.used) ?? 0;
  const window = numberOr(contextRecord?.window) ?? 0;
  const rows: SessionHarnessUsageState['rows'] = [];
  if (usageRecord) {
    rows.push({ label: 'Latest input', value: formatTokens(prompt) });
    rows.push({ label: 'Latest output', value: formatTokens(completion) });
    const cacheRead = numberOr(lastRecord?.cacheRead);
    if (cacheRead !== null && cacheRead > 0) rows.push({ label: 'Latest cached input', value: formatTokens(cacheRead) });
    const cacheWrite = numberOr(lastRecord?.cacheWrite);
    if (cacheWrite !== null && cacheWrite > 0) rows.push({ label: 'Latest cache creation', value: formatTokens(cacheWrite) });
  }
  if (contextRecord) {
    rows.push({ label: 'Context', value: `${formatTokens(used)} / ${formatTokens(window)}` });
  }
  return { used, contextWindow: window, rows };
}

/** Prokop usage from the session's own token totals. */
function prokopUsageState(session: UsageSource): SessionHarnessUsageState | null {
  const total = numberOr(session.totalTokens);
  if (total === null || total === 0) return null;
  const prompt = numberOr(session.promptTokens) ?? 0;
  const completion = numberOr(session.completionTokens) ?? 0;
  return {
    used: total,
    contextWindow: 0,
    rows: [
      { label: 'Input', value: formatTokens(prompt) },
      { label: 'Output', value: formatTokens(completion) },
      { label: 'Total', value: formatTokens(total) },
    ],
  };
}

/** Derive the normalized harness state for a persisted session. */
export function deriveSessionHarnessState(
  harness: SessionHarness | undefined,
  metadata: Record<string, unknown> | null | undefined,
  usageSource?: UsageSource,
): SessionHarnessState {
  const owner = harness ?? 'prokop';
  const meta = codexObject(metadata);

  if (owner === 'codex-cli') {
    return {
      compaction: {
        pending: meta.codexCompactPending === true,
        uncertain: false,
        boundaryMessageId: compactionBoundary(meta, 'codexCompactedAfterMessageId'),
      },
      fork: { mode: 'assistant-only' },
      goal: codexGoalState(meta),
      usage: codexUsageState(meta),
      goalUncertain: false,
      nativeApprovalPrefix: 'codex-approval:',
      capabilities: {
        canRemoveQueuedMessages: false,
        canInterruptSubagent: true,
        subagentActivityPropagates: true,
      },
    };
  }

  if (owner === 'claude-cli') {
    const compactPending = meta.claudeCompactPending === true;
    const ranGoalOrCompact = Boolean(meta.claudeGoal) || Boolean(meta.claudeCompactedAt);
    const goal = claudeGoalState(meta);
    return {
      compaction: {
        pending: false,
        uncertain: compactPending,
        boundaryMessageId: compactionBoundary(meta, 'claudeCompactedAfterMessageId'),
      },
      fork: compactPending || ranGoalOrCompact
        ? {
          mode: 'restricted',
          reason: compactPending
            ? 'Fork unavailable: compaction outcome uncertain'
            : 'Fork unavailable after Goal or Compact',
        }
        : { mode: 'any' },
      goal,
      usage: claudeUsageState(meta),
      goalUncertain: goal?.status === 'uncertain',
      nativeApprovalPrefix: 'claude-approval:',
      capabilities: {
        canRemoveQueuedMessages: true,
        canInterruptSubagent: false,
        subagentActivityPropagates: false,
      },
    };
  }

  return {
    compaction: { pending: false, uncertain: false, boundaryMessageId: null },
    fork: { mode: 'any' },
    goal: null,
    usage: usageSource ? prokopUsageState(usageSource) : null,
    goalUncertain: false,
    capabilities: {
      canRemoveQueuedMessages: true,
      canInterruptSubagent: false,
      subagentActivityPropagates: false,
    },
  };
}

/** Attach the derived harness state to a session at the storage boundary. */
export function withDerivedHarnessState<T extends Session>(session: T): T {
  return {
    ...session,
    harnessState: deriveSessionHarnessState(
      session.harness,
      session.metadata,
      session as UsageSource,
    ),
  };
}
