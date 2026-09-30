import type {
  Session,
  SessionHarness,
  SessionHarnessState,
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

function compactionBoundary(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Derive the normalized harness state for a persisted session. */
export function deriveSessionHarnessState(
  harness: SessionHarness | undefined,
  metadata: Record<string, unknown> | null | undefined,
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
    const goal = meta.claudeGoal as { status?: unknown } | undefined;
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
    harnessState: deriveSessionHarnessState(session.harness, session.metadata),
  };
}
