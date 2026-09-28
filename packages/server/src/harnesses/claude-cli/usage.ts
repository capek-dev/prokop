export interface ClaudeTurnUsage {
  prompt: number;
  completion: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextWindow: number | null;
}

const count = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= 0;

/** SDK modelUsage counts all calls in this query, including Agent children. */
export function parseClaudeUsage(value: unknown, selectedModel: string): ClaudeTurnUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 100) return null;
  let prompt = 0;
  let completion = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let contextWindow: number | null = null;
  for (const [model, raw] of entries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    if (!count(row.inputTokens) || !count(row.outputTokens) || !count(row.cacheReadInputTokens)
      || !count(row.cacheCreationInputTokens) || typeof row.costUSD !== 'number'
      || !Number.isFinite(row.costUSD) || row.costUSD < 0) return null;
    prompt += row.inputTokens;
    completion += row.outputTokens;
    cacheRead += row.cacheReadInputTokens;
    cacheWrite += row.cacheCreationInputTokens;
    cost += row.costUSD;
    if (model === selectedModel && count(row.contextWindow) && row.contextWindow > 0) {
      contextWindow = row.contextWindow;
    }
  }
  if (![prompt, completion, cacheRead, cacheWrite].every(count) || !Number.isFinite(cost)) return null;
  return { prompt, completion, cacheRead, cacheWrite, cost, contextWindow };
}
