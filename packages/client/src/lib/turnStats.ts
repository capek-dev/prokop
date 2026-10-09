import type { AssistantMessage, ToolState } from '@prokopai/sdk';

/** Whole seconds, for live timers that tick once per second. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

/** Finished durations: one decimal below 10s, where the difference matters. */
export function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  return formatElapsed(ms);
}

export function formatCompactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export interface TurnMeta {
  model?: string;
  duration?: string;
  tokens?: string;
  tokensTitle?: string;
}

/**
 * Display values for a finished assistant turn. Values a harness never
 * records (Codex tokens, Claude CLI usage without a report) are zero in
 * storage, so zero means unknown and is hidden. Cost is left out: Claude
 * Code reports an API-price estimate even on subscriptions.
 */
export function getTurnMeta(message: AssistantMessage): TurnMeta {
  const meta: TurnMeta = {};
  if (message.modelId) meta.model = message.modelId;

  if (message.status !== 'streaming' && message.completedAt !== undefined
    && message.completedAt >= message.createdAt) {
    meta.duration = formatDuration(message.completedAt - message.createdAt);
  }

  const { prompt, completion, cacheRead } = message.tokens ?? { prompt: 0, completion: 0 };
  const total = (prompt ?? 0) + (completion ?? 0);
  if (total > 0) {
    meta.tokens = `${formatCompactCount(total)} tok`;
    meta.tokensTitle = [
      `${formatCompactCount(prompt ?? 0)} in`,
      `${formatCompactCount(completion ?? 0)} out`,
      ...(cacheRead ? [`${formatCompactCount(cacheRead)} cache read`] : []),
    ].join(' · ');
  }

  return meta;
}

/** Wall time of a finished tool call; undefined while it is still running. */
export function getToolDurationMs(state: ToolState): number | undefined {
  switch (state.status) {
    case 'completed':
      return state.completedAt - state.startedAt;
    case 'error':
      return state.failedAt - state.startedAt;
    case 'interrupted':
      return state.interruptedAt - state.startedAt;
    default:
      return undefined;
  }
}

const INTERRUPT_REASON_LABELS = {
  user_request: 'stopped',
  timeout: 'timed out',
  error: 'interrupted',
  cascade: 'cancelled',
} as const;

export function getInterruptReasonLabel(state: ToolState): string | undefined {
  return state.status === 'interrupted' ? INTERRUPT_REASON_LABELS[state.reason] : undefined;
}

export function firstLine(text: string): string {
  return text.split('\n').find(line => line.trim())?.trim() ?? '';
}
