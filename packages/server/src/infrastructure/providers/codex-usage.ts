import { z } from 'zod';
import type { CodexAccountUsage, ProviderUsageWindow } from '@prokopai/sdk';
import type { CodexAccountUsagePort } from '@/application/ports/provider-accounts';
import type { CodexAccountRuntime } from './codex-account-runtime';
import type { CodexAccountStore } from './codex-accounts';

const ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage';
const windowSchema = z.object({
  used_percent: z.number().finite().min(0).max(100),
  limit_window_seconds: z.number().int().positive(),
  reset_at: z.number().int().nonnegative().max(8_640_000_000_000).nullish(),
});
const limitsSchema = z.object({
  primary_window: windowSchema.nullish(),
  secondary_window: windowSchema.nullish(),
});
const payloadSchema = z.object({
  plan_type: z.string().max(80).nullish(),
  rate_limit: limitsSchema.nullish(),
  code_review_rate_limit: limitsSchema.nullish(),
  additional_rate_limits: z.array(z.object({
    limit_name: z.string().min(1).max(120),
    rate_limit: limitsSchema.nullish(),
  })).max(100).nullish(),
});

export function parseCodexAccountUsage(accountId: string, payload: unknown, now: number): CodexAccountUsage {
  const data = payloadSchema.parse(payload);
  const windows: ProviderUsageWindow[] = [];
  const add = (limits: z.infer<typeof limitsSchema> | null | undefined, prefix: string, name = '') => {
    for (const key of ['primary_window', 'secondary_window'] as const) {
      const window = limits?.[key];
      if (!window) continue;
      const seconds = window.limit_window_seconds;
      const duration = seconds === 604800 ? 'Weekly' : seconds % 3600 === 0 ? `${seconds / 3600}-hour`
        : seconds % 60 === 0 ? `${seconds / 60}-minute` : `${seconds}-second`;
      windows.push({
        id: `${prefix}-${key}`, label: name ? `${name} · ${duration}` : duration,
        usedPercent: window.used_percent,
        ...(window.reset_at != null ? { resetsAt: new Date(window.reset_at * 1000).toISOString() } : {}),
      });
    }
  };
  add(data.rate_limit, 'codex');
  add(data.code_review_rate_limit, 'review', 'Code review');
  data.additional_rate_limits?.forEach((entry, index) => add(entry.rate_limit, `additional-${index}`, entry.limit_name));
  return {
    accountId, checkedAt: new Date(now).toISOString(), plan: data.plan_type ?? null, windows,
    ...(windows.length ? {} : { unavailable: { reason: 'unsupported' as const, message: 'No subscription limits were reported for this account.' } }),
  };
}

export function createCodexAccountUsagePort({ accounts, runtime, now = Date.now, timeoutMs = 8_000 }: {
  accounts: Pick<CodexAccountStore, 'get'>;
  runtime: Pick<CodexAccountRuntime, 'createFetch'>;
  now?: () => number;
  timeoutMs?: number;
}): CodexAccountUsagePort {
  interface Entry {
    connectionId: string;
    expires: number;
    pending: Promise<CodexAccountUsage>;
  }
  const entries = new Map<string, Entry>();
  const unavailable = (accountId: string, reason: NonNullable<CodexAccountUsage['unavailable']>['reason'], message: string): CodexAccountUsage => ({
    accountId, checkedAt: new Date(now()).toISOString(), plan: null, windows: [], unavailable: { reason, message },
  });

  return {
    async read(accountId) {
      // Prune removed accounts and expired snapshots without background polling.
      for (const [id, entry] of entries) {
        if (entry.expires <= now() || accounts.get(id)?.connectionId !== entry.connectionId) entries.delete(id);
      }
      const account = accounts.get(accountId);
      if (!account) return unavailable(accountId, 'notConnected', 'This Codex account is no longer connected.');
      if (account.reauthRequired) {
        entries.delete(accountId);
        return unavailable(accountId, 'reauthRequired', 'Reconnect this Codex account in LLM providers.');
      }
      const cached = entries.get(accountId);
      if (cached) return cached.pending;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Usage deadline')); }, timeoutMs);
      });
      const probe = async () => {
        const fetch = await runtime.createFetch(accountId);
        controller.signal.throwIfAborted();
        const response = await fetch(ENDPOINT, { signal: controller.signal, redirect: 'error' });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error('Usage request failed');
        }
        return parseCodexAccountUsage(accountId, await response.json(), now());
      };
      const pending = Promise.race([probe(), deadline]).catch(() => {
        const reauth = accounts.get(accountId)?.reauthRequired;
        return unavailable(accountId, reauth ? 'reauthRequired' : 'probeFailed', reauth
          ? 'Reconnect this Codex account in LLM providers.' : 'Could not read usage for this Codex account.');
      }).then(result => {
        const current = accounts.get(accountId);
        if (!current || current.connectionId !== account.connectionId) {
          result = unavailable(accountId, 'notConnected', 'This Codex account changed. Refresh its usage.');
        } else if (current.reauthRequired) {
          result = unavailable(accountId, 'reauthRequired', 'Reconnect this Codex account in LLM providers.');
        }
        if (entries.get(accountId) === entry) {
          if (result.unavailable) entries.delete(accountId);
          else entry.expires = now() + 30_000;
        }
        return result;
      }).finally(() => clearTimeout(timer));
      const entry: Entry = { connectionId: account.connectionId, expires: Infinity, pending };
      entries.set(accountId, entry);
      return entry.pending;
    },
  };
}
