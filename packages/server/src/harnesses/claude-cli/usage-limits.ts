import type { HarnessUsageLimits, HarnessUsageWindow } from '@prokopai/sdk';
import { clampUsagePercent, createUsageLimitsCache, unavailableUsageLimits, usageLimits } from '@/harnesses/shared/usage-limits';
import { runClaudeControlProbe } from './model-probe';

const FIXED_WINDOWS = [
  ['five_hour', 'session', '5-hour'],
  ['seven_day', 'weekly', 'Weekly'],
  ['seven_day_opus', 'weekly', 'Weekly (Opus)'],
  ['seven_day_sonnet', 'weekly', 'Weekly (Sonnet)'],
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function window(id: string, kind: HarnessUsageWindow['kind'], label: string, raw: unknown): HarnessUsageWindow | null {
  const entry = record(raw);
  if (!entry || typeof entry.utilization !== 'number' || !Number.isFinite(entry.utilization)) return null;
  const resetsAt = typeof entry.resets_at === 'string' && Number.isFinite(Date.parse(entry.resets_at))
    ? new Date(entry.resets_at).toISOString() : undefined;
  return { id, kind, label, usedPercent: clampUsagePercent(entry.utilization), ...(resetsAt ? { resetsAt } : {}) };
}

/** Map the SDK `get_usage` response (experimental shape) onto usage windows. */
export function parseClaudeUsageLimits(value: unknown): HarnessUsageLimits {
  const response = record(value);
  if (!response) return unavailableUsageLimits('claude-cli', 'probeFailed', 'Claude returned an unreadable usage response.');
  const plan = typeof response.subscription_type === 'string' ? response.subscription_type : null;
  const limits = record(response.rate_limits);
  if (response.rate_limits_available === false || !limits) {
    return unavailableUsageLimits('claude-cli', 'unsupported',
      'Plan limits apply only to Claude subscription logins, not API keys or cloud providers.', plan);
  }
  const windows: HarnessUsageWindow[] = [];
  for (const [id, kind, label] of FIXED_WINDOWS) {
    const parsed = window(id, kind, label, limits[id]);
    if (parsed) windows.push(parsed);
  }
  if (Array.isArray(limits.model_scoped)) {
    for (const raw of limits.model_scoped) {
      const name = record(raw)?.display_name;
      if (typeof name !== 'string' || !name) continue;
      const parsed = window(`model:${name}`, 'weekly', `Weekly (${name})`, raw);
      if (parsed && !windows.some(existing => existing.label === parsed.label)) windows.push(parsed);
    }
  }
  return usageLimits('claude-cli', plan, windows);
}

export async function readClaudeUsageLimits(
  probe: () => Promise<unknown> = () => runClaudeControlProbe('Claude usage read', async q => {
    await q.initializationResult();
    return q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
  }),
): Promise<HarnessUsageLimits> {
  try {
    return parseClaudeUsageLimits(await probe());
  } catch {
    return unavailableUsageLimits('claude-cli', 'probeFailed', 'Claude CLI did not report usage.');
  }
}

const cachedClaudeUsageLimits = createUsageLimitsCache(() => readClaudeUsageLimits());

/** Usage over a short shared cache; each uncached read starts the Claude CLI. */
export function readCachedClaudeUsageLimits(): Promise<HarnessUsageLimits> {
  return cachedClaudeUsageLimits();
}
