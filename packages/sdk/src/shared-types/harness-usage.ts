import type { SessionHarness } from './session';

export type HarnessUsageWindowKind = 'session' | 'weekly' | 'monthly' | 'other';

/** One subscription rate-limit window, e.g. the 5-hour or weekly allowance. */
export interface HarnessUsageWindow {
  /** Stable per harness (`five_hour`, `primary`, ...) so later updates can merge by id. */
  id: string;
  kind: HarnessUsageWindowKind;
  label: string;
  /** 0 to 100. */
  usedPercent: number;
  /** ISO 8601 reset time when the CLI reports one. */
  resetsAt?: string;
}

/**
 * Plan usage as read from a native harness CLI. `unavailable` separates
 * accounts that never have plan limits (`unsupported`, e.g. API keys) from a
 * read that failed this time (`probeFailed`).
 */
export interface HarnessUsageLimits {
  harness: Exclude<SessionHarness, 'prokop'>;
  checkedAt: string;
  plan: string | null;
  windows: HarnessUsageWindow[];
  unavailable?: {
    reason: 'unsupported' | 'probeFailed';
    message?: string;
  };
}
