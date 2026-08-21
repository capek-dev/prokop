/**
 * Environment variable compatibility layer for the jean2 → prokopai rename.
 *
 * Canonical prefix: PROKOPAI_. Legacy prefix: JEAN2_ (deprecated, removal in
 * ~2 minors). Resolution rule: PROKOPAI_X set → wins; else JEAN2_X → used
 * with a one-time deprecation warning per key.
 *
 * All server env reads should go through readEnv/readEnvInt/readEnvFloat so
 * the fallback is removed in one place later.
 */

export const PROKOPAI_ENV_PREFIX = 'PROKOPAI_';
export const JEAN2_ENV_PREFIX = 'JEAN2_';

const warnedKeys = new Set<string>();

/** Test hook: clear the warn-once state. */
export function resetEnvCompatWarnings(): void {
  warnedKeys.clear();
}

function resolveKey(suffix: string): { value: string | undefined; legacyUsed: boolean } {
  const canonical = process.env[`${PROKOPAI_ENV_PREFIX}${suffix}`];
  if (canonical !== undefined) {
    return { value: canonical, legacyUsed: false };
  }

  const legacy = process.env[`${JEAN2_ENV_PREFIX}${suffix}`];
  if (legacy !== undefined) {
    return { value: legacy, legacyUsed: true };
  }

  return { value: undefined, legacyUsed: false };
}

function warnLegacy(suffix: string, legacyUsed: boolean): void {
  if (!legacyUsed || warnedKeys.has(suffix)) return;
  warnedKeys.add(suffix);
  console.warn(
    `[prokopai] JEAN2_${suffix} is deprecated; rename to PROKOPAI_${suffix}. ` +
      'Legacy support will be removed in a future release.',
  );
}

/** Read an env var: PROKOPAI_<suffix> ?? JEAN2_<suffix>, warn once on legacy use. */
export function readEnv(suffix: string): string | undefined {
  const { value, legacyUsed } = resolveKey(suffix);
  warnLegacy(suffix, legacyUsed);
  return value;
}

/** readEnv parsed as int with fallback. Invalid or legacy-missing → default. */
export function readEnvInt(suffix: string, defaultValue: number): number {
  const raw = readEnv(suffix);
  const parsed = parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/** readEnv parsed as float with fallback. Invalid or legacy-missing → default. */
export function readEnvFloat(suffix: string, defaultValue: number): number {
  const raw = readEnv(suffix);
  const parsed = parseFloat(raw ?? '');
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/** Whether the legacy variable is set at all (used by clear paths that must strip both prefixes). */
export function legacyEnvKey(suffix: string): string {
  return `${JEAN2_ENV_PREFIX}${suffix}`;
}
