export interface CodexTokenBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

/** Most recent Codex response and cumulative thread usage, not Goal budget usage. */
export interface CodexContextUsage {
  last: CodexTokenBreakdown;
  total: CodexTokenBreakdown;
  modelContextWindow: number | null;
}
