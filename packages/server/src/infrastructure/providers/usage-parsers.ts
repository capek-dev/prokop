import type { ProviderUsage, ProviderUsageWindow, UsageProvider } from '@prokopai/sdk';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid usage object');
  return value as Record<string, unknown>;
}

function number(value: unknown): number {
  const parsed = typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) throw new Error('Invalid usage number');
  return parsed;
}

function percent(value: unknown): number {
  const result = number(value);
  if (result < 0 || result > 100) throw new Error('Invalid usage percentage');
  return result;
}

function decimal(value: unknown): string {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
    throw new Error('Invalid balance');
  }
  return value;
}

function reset(value: unknown, milliseconds = false): string | undefined {
  if (value == null) return undefined;
  const epoch = number(value);
  const date = new Date(milliseconds || epoch > 1e12 ? epoch : epoch * 1000);
  if (epoch <= 0 || !Number.isFinite(date.getTime())) return undefined;
  return date.toISOString();
}

function isCodingQuota(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/[_-]/g, ' ');
  return normalized === 'general' || normalized === 'text generation' || /^minimax m\d/.test(normalized);
}

function plan(data: Record<string, unknown>): string | null {
  for (const key of ['planName', 'plan', 'plan_type', 'packageName', 'level', 'current_subscribe_title', 'plan_name', 'combo_title', 'current_plan_title']) {
    if (typeof data[key] === 'string' && data[key].trim()) return data[key].trim().slice(0, 100);
  }
  return null;
}

export function emptyProviderUsage(provider: UsageProvider, now: number): ProviderUsage {
  return { provider, checkedAt: new Date(now).toISOString(), plan: null, windows: [], balances: [] };
}

export function parseProviderUsage(provider: UsageProvider, value: unknown, now = Date.now()): ProviderUsage {
  const result = emptyProviderUsage(provider, now);
  const root = object(value);
  if (provider === 'deepseek') {
    if (typeof root.is_available !== 'boolean' || !Array.isArray(root.balance_infos) || !root.balance_infos.length) {
      throw new Error('Missing balances');
    }
    result.balances = root.balance_infos.map((raw) => {
      const balance = object(raw);
      if (balance.currency !== 'USD' && balance.currency !== 'CNY') throw new Error('Unknown currency');
      return {
        currency: balance.currency,
        remaining: decimal(balance.total_balance),
        granted: decimal(balance.granted_balance),
        toppedUp: decimal(balance.topped_up_balance),
      };
    });
    return result;
  }

  if (provider === 'zhipu-coding') {
    if (root.code !== 200 || root.success === false) throw new Error('Quota request failed');
    const data = object(root.data);
    if (!Array.isArray(data.limits)) throw new Error('Missing quota limits');
    result.plan = plan(data);
    result.windows = data.limits.flatMap((raw, index): ProviderUsageWindow[] => {
      const limit = object(raw);
      if (typeof limit.type !== 'string') throw new Error('Missing quota type');
      if (!['TOKENS_LIMIT', 'CREDIT_LIMIT', 'TIME_LIMIT'].includes(limit.type)) return [];
      let usedPercent = percent(limit.percentage);
      if (limit.usage != null) {
        const total = number(limit.usage);
        if (total < 0) throw new Error('Invalid quota total');
        const current = limit.currentValue == null ? undefined : number(limit.currentValue);
        const remaining = limit.remaining == null ? undefined : number(limit.remaining);
        if ((current != null && current < 0) || (remaining != null && remaining < 0)) throw new Error('Invalid quota count');
        if (total > 0 && (current != null || remaining != null)) {
          usedPercent = Math.min(100, Math.max(0, Math.max(current ?? 0, remaining == null ? 0 : total - remaining) / total * 100));
        }
      }
      const unit = number(limit.unit);
      const count = number(limit.number);
      const duration = unit === 3 ? `${count}-hour` : unit === 6 ? `${count}-week` : unit === 1 ? `${count}-day` : 'Quota';
      const label = limit.type === 'TIME_LIMIT' ? 'MCP allowance' : duration;
      let resetsAt = reset(limit.nextResetTime, true);
      // Some five-hour responses contain a reset shifted by a timezone offset.
      if (unit === 3 && count === 5 && resetsAt && Date.parse(resetsAt) > now + 301 * 60_000) resetsAt = undefined;
      return [{ id: `${limit.type}-${unit}-${count}-${index}`, label, usedPercent, ...(resetsAt ? { resetsAt } : {}) }];
    });
  } else {
    const data = root.data == null ? root : object(root.data);
    for (const status of [root.base_resp, data.base_resp]) {
      if (status != null && number(object(status).status_code) !== 0) throw new Error('Quota request failed');
    }
    result.plan = plan(data);
    if (!Array.isArray(data.model_remains) && Array.isArray(data.services)) {
      result.windows = data.services.flatMap((raw, index): ProviderUsageWindow[] => {
        const service = object(raw);
        if (typeof service.service_type !== 'string' || typeof service.window_type !== 'string') throw new Error('Missing service window');
        if (!isCodingQuota(service.service_type)) return [];
        const total = number(service.limit);
        const used = number(service.usage);
        if (total <= 0 || used < 0) throw new Error('Invalid service quota');
        return [{
          id: `${service.service_type}-${service.window_type}-${index}`,
          label: `${service.service_type.slice(0, 100)} · ${service.window_type.slice(0, 100)}`,
          usedPercent: service.percent == null ? Math.min(100, used / total * 100) : percent(service.percent),
        }];
      });
    } else {
      if (!Array.isArray(data.model_remains)) throw new Error('Missing model quota');
      result.windows = data.model_remains.flatMap((raw, index): ProviderUsageWindow[] => {
        const model = object(raw);
        if (typeof model.model_name !== 'string' || !model.model_name.trim()) throw new Error('Missing model name');
        const modelName = model.model_name;
        if (!isCodingQuota(modelName)) return [];
        return (['interval', 'weekly'] as const).flatMap((period): ProviderUsageWindow[] => {
          const prefix = `current_${period}`;
          const totalRaw = model[`${prefix}_total_count`];
          const remainingRaw = model[`${prefix}_usage_count`];
          const percentRaw = model[`${prefix}_remaining_percent`];
          if (totalRaw == null && remainingRaw == null && percentRaw == null) return [];
          const total = totalRaw == null ? undefined : number(totalRaw);
          const remaining = remainingRaw == null ? undefined : number(remainingRaw);
          if ((total != null && total < 0) || (remaining != null && remaining < 0)) throw new Error('Invalid quota count');
          const id = `${modelName}-${period}-${index}`;
          const start = reset(model.start_time);
          const end = reset(model.end_time);
          const hours = start && end ? (Date.parse(end) - Date.parse(start)) / 3_600_000 : null;
          const label = period === 'weekly' ? 'Weekly' : hours != null && hours > 0 ? `${hours}-hour` : 'Current window';
          const status = model[`${prefix}_status`];
          if (status != null && number(status) === 3) {
            // MiniMax's general/text weekly lane uses this exact pattern for unlimited quota.
            const name = modelName.trim().toLowerCase().replace(/[_-]/g, ' ');
            if (period === 'weekly' && ['general', 'text generation'].includes(name)
              && total === 0 && remaining === 0 && percentRaw != null && percent(percentRaw) === 100) {
              return [{ id, label, unlimited: true }];
            }
            return [];
          }
          let usedPercent: number;
          if (percentRaw != null) usedPercent = 100 - percent(percentRaw);
          else if (total != null && total > 0 && remaining != null && remaining <= total) usedPercent = (total - remaining) / total * 100;
          else if (total === 0 && remaining === 0) return [];
          else throw new Error('Incomplete quota counts');
          const resetsAt = reset(model[period === 'weekly' ? 'weekly_end_time' : 'end_time']);
          return [{
            id,
            label,
            usedPercent,
            ...(resetsAt ? { resetsAt } : {}),
          }];
        });
      });
    }
  }
  if (!result.windows.length) result.unavailable = {
    reason: 'unsupported', message: 'No supported quota windows were reported for this account. Check the provider dashboard.',
  };
  return result;
}
