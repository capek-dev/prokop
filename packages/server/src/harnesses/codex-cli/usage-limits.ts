import type { HarnessUsageLimits, HarnessUsageWindow } from '@prokopai/sdk';
import { clampUsagePercent, createUsageLimitsCache, unavailableUsageLimits, usageLimits } from '@/harnesses/shared/usage-limits';
import { CodexAppServer, codexObject, spawnCodexAppServer, type CodexConnection } from './app-server';
import { codexCliVersion } from './version';

const SESSION_MINS = 5 * 60;
const WEEK_MINS = 7 * 24 * 60;
const MONTH_MINS = 30 * 24 * 60;

function kindFor(mins: number): HarnessUsageWindow['kind'] {
  if (mins >= MONTH_MINS) return 'monthly';
  if (mins >= WEEK_MINS) return 'weekly';
  return 'session';
}

function labelFor(kind: HarnessUsageWindow['kind'], mins: number): string {
  if (kind === 'monthly') return 'Monthly';
  if (kind === 'weekly') return 'Weekly';
  return mins % 60 === 0 ? `${mins / 60}-hour` : `${mins}-minute`;
}

/**
 * `primary` and `secondary` are positions, not durations. Codex normally sends
 * `windowDurationMins`; without it, paid plans mean the 5-hour and weekly pair
 * and Free/Go plans mean one monthly allowance.
 */
export function parseCodexUsageLimits(value: unknown): HarnessUsageLimits {
  const response = codexObject(value);
  // Model-specific buckets (such as Spark) must not stand in for the main allowance.
  const snapshot = codexObject(codexObject(response?.rateLimitsByLimitId)?.codex) ?? codexObject(response?.rateLimits);
  if (!snapshot) return unavailableUsageLimits('codex-cli', 'probeFailed', 'Codex returned an unreadable usage response.');
  const plan = typeof snapshot.planType === 'string' ? snapshot.planType : null;
  if (typeof snapshot.limitId === 'string' && snapshot.limitId !== 'codex') {
    return unavailableUsageLimits('codex-cli', 'unsupported', 'Codex reported no plan limits for this account.', plan);
  }
  const monthlyPlan = plan === 'free' || plan === 'go';
  const windows: HarnessUsageWindow[] = [];
  for (const [id, fallbackMins] of [['primary', monthlyPlan ? MONTH_MINS : SESSION_MINS], ['secondary', WEEK_MINS]] as const) {
    const entry = codexObject(snapshot[id]);
    if (!entry || typeof entry.usedPercent !== 'number' || !Number.isFinite(entry.usedPercent)) continue;
    const mins = typeof entry.windowDurationMins === 'number' && entry.windowDurationMins > 0
      ? entry.windowDurationMins : fallbackMins;
    const kind = kindFor(mins);
    const resetsAt = typeof entry.resetsAt === 'number' && Number.isFinite(entry.resetsAt) && entry.resetsAt > 0
      ? new Date(entry.resetsAt * 1000).toISOString() : undefined;
    windows.push({ id, kind, label: labelFor(kind, mins), usedPercent: clampUsagePercent(entry.usedPercent),
      ...(resetsAt ? { resetsAt } : {}) });
  }
  if (windows.length === 0) {
    return unavailableUsageLimits('codex-cli', 'unsupported',
      'Plan limits apply only to ChatGPT logins, not API keys.', plan);
  }
  return usageLimits('codex-cli', plan, windows);
}

export interface CodexUsageDependencies {
  connect(): CodexConnection;
  version(): string;
}

const defaultDependencies: CodexUsageDependencies = { connect: spawnCodexAppServer, version: codexCliVersion };

export async function readCodexUsageLimits(deps: CodexUsageDependencies = defaultDependencies): Promise<HarnessUsageLimits> {
  let client: CodexAppServer | null = null;
  try {
    deps.version();
    client = new CodexAppServer(deps.connect(), () => {});
    await client.initialize();
    return parseCodexUsageLimits(await client.request('account/rateLimits/read', null));
  } catch {
    return unavailableUsageLimits('codex-cli', 'probeFailed', 'Codex CLI did not report usage.');
  } finally {
    await client?.close();
  }
}

const cachedCodexUsageLimits = createUsageLimitsCache(() => readCodexUsageLimits());

/** Usage over a short shared cache; each uncached read spawns a Codex app-server. */
export function readCachedCodexUsageLimits(): Promise<HarnessUsageLimits> {
  return cachedCodexUsageLimits();
}
