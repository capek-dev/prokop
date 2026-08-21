import { readEnv } from '@/infrastructure/runtime/env-compat';

const PERF_DIAGNOSTICS_ENABLED =
  readEnv('PERF_DIAGNOSTICS') === 'true';

export interface PerfMeasurement {
  operation: string;
  durationMs: number;
  attributes: Record<string, string | number | boolean | null>;
}

function emit(measurement: PerfMeasurement): void {
  const parts = [measurement.operation, `${measurement.durationMs.toFixed(2)}ms`];
  for (const [key, value] of Object.entries(measurement.attributes)) {
    parts.push(`${key}=${value}`);
  }
  console.log(`[perf] ${parts.join(' ')}`);
}

export function measureSync<T>(
  operation: string,
  attributes: Record<string, string | number | boolean | null>,
  fn: () => T,
): T {
  if (!PERF_DIAGNOSTICS_ENABLED) {
    return fn();
  }

  const start = performance.now();
  try {
    return fn();
  } finally {
    const durationMs = performance.now() - start;
    emit({ operation, durationMs, attributes });
  }
}

export async function measureAsync<T>(
  operation: string,
  attributes: Record<string, string | number | boolean | null>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!PERF_DIAGNOSTICS_ENABLED) {
    return fn();
  }

  const start = performance.now();
  try {
    return await fn();
  } finally {
    const durationMs = performance.now() - start;
    emit({ operation, durationMs, attributes });
  }
}

export function isPerfDiagnosticsEnabled(): boolean {
  return PERF_DIAGNOSTICS_ENABLED;
}
