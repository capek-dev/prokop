import type { ProviderUsage, UsageProvider } from '@prokopai/sdk';
import type { ProviderUsagePort } from '@/application/ports/provider-accounts';
import { emptyProviderUsage, parseProviderUsage } from './usage-parsers';

const ENDPOINTS: Record<UsageProvider, string[]> = {
  deepseek: ['https://api.deepseek.com/user/balance'],
  'zhipu-coding': ['https://api.z.ai/api/monitor/usage/quota/limit'],
  minimax: ['https://api.minimax.io/v1/token_plan/remains', 'https://api.minimax.io/v1/api/openplatform/coding_plan/remains'],
};

interface UsageDependencies {
  getKey: (provider: UsageProvider) => string | undefined;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  timeoutMs?: number;
}

interface CacheEntry {
  key: string;
  pending?: Promise<ProviderUsage>;
  value?: ProviderUsage;
  expiresAt: number;
}

/** Per-application cache, bounded to three providers. Never retain old credential generations. */
export function createProviderUsagePort(deps: UsageDependencies): ProviderUsagePort {
  const cache = new Map<UsageProvider, CacheEntry>();
  const now = deps.now ?? Date.now;
  const request = deps.fetch ?? fetch;

  async function read(provider: UsageProvider, key: string): Promise<ProviderUsage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8_000);
    try {
      const endpoints = ENDPOINTS[provider];
      for (const [index, url] of endpoints.entries()) {
        const response = await request(url, {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: controller.signal,
          redirect: 'error',
        });
        // Legacy MiniMax accounts may not expose the token-plan endpoint.
        if (index < endpoints.length - 1 && [401, 403, 404, 405].includes(response.status)) {
          await response.body?.cancel();
          continue;
        }
        if (!response.ok) throw new Error('Usage request failed');
        const body: unknown = await response.json();
        try {
          return parseProviderUsage(provider, body, now());
        } catch (error: unknown) {
          if (index === endpoints.length - 1 || controller.signal.aborted) throw error;
        }
      }
      throw new Error('No usage response');
    } catch (_error: unknown) {
      // Provider bodies and transport errors can echo credentials. Never return or log them.
      return {
        ...emptyProviderUsage(provider, now()),
        unavailable: { reason: 'probeFailed', message: 'Could not read usage with the configured API key. Check the provider dashboard or try again.' },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    invalidate(provider) {
      cache.delete(provider as UsageProvider);
    },
    async read(provider) {
      const key = deps.getKey(provider)?.trim();
      if (!key) {
        cache.delete(provider);
        return { ...emptyProviderUsage(provider, now()), unavailable: { reason: 'notConfigured', message: 'Configure an API key in Providers & models.' } };
      }
      let entry = cache.get(provider);
      if (!entry || entry.key !== key) {
        entry = { key, expiresAt: 0 };
        cache.set(provider, entry);
      }
      if (entry.value && entry.expiresAt > now()) return entry.value;
      if (entry.pending) return entry.pending;
      const generation = entry;
      generation.pending = read(provider, key).then((value) => {
        if (cache.get(provider) !== generation || deps.getKey(provider)?.trim() !== key) {
          return { ...emptyProviderUsage(provider, now()), unavailable: { reason: 'probeFailed' as const, message: 'Provider credentials changed. Refresh usage.' } };
        }
        if (!value.unavailable) {
          generation.value = value;
          generation.expiresAt = now() + 30_000;
        }
        return value;
      }).finally(() => { generation.pending = undefined; });
      return generation.pending;
    },
  };
}
