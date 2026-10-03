/** Provider-account usage, including consumption outside Prokop. */
export type UsageProvider = 'deepseek' | 'zhipu-coding' | 'minimax';

export type ProviderUsageWindow = {
  id: string;
  label: string;
} & ({
  unlimited: true;
  usedPercent?: never;
  resetsAt?: never;
} | {
  unlimited?: false;
  usedPercent: number;
  resetsAt?: string;
});

/** Subscription limits for one locally stored Prokop Codex account, not a CLI login. */
export interface CodexAccountUsage {
  accountId: string;
  checkedAt: string;
  plan: string | null;
  windows: ProviderUsageWindow[];
  unavailable?: {
    reason: 'notConnected' | 'reauthRequired' | 'unsupported' | 'probeFailed';
    message: string;
  };
}

export interface ProviderUsageBalance {
  currency: string;
  /** Decimal strings preserve the provider's monetary precision. */
  remaining: string;
  granted?: string;
  toppedUp?: string;
}

export interface ProviderUsage {
  provider: UsageProvider;
  checkedAt: string;
  plan: string | null;
  windows: ProviderUsageWindow[];
  balances: ProviderUsageBalance[];
  unavailable?: {
    reason: 'notConfigured' | 'unsupported' | 'probeFailed';
    message: string;
  };
}
