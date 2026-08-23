import { existsSync, readFileSync } from 'fs';
import { getEnvFilePath, getToolsDir, getPreconfigsDir } from './paths';
import { readEnv, readEnvFloat, readEnvInt, JEAN2_ENV_PREFIX, PROKOPAI_ENV_PREFIX } from './env-compat';

const envOverlay = new Map<string, string>();

function loadEnvFile(): void {
  const envPath = getEnvFilePath();
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    const cleanValue = value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1)
      : value.startsWith("'") && value.endsWith("'")
        ? value.slice(1, -1)
        : value;

    if (process.env[key] === undefined) {
      process.env[key] = cleanValue;
    }
    envOverlay.set(key, cleanValue);
  }
}

loadEnvFile();

/**
 * Resolve an env value across the overlay and process env with legacy-prefix
 * fallback. Canonical PROKOPAI_<suffix> wins; legacy JEAN2_<suffix> is used
 * when canonical is unset. The overlay (values loaded from ~/.prokopai/.env)
 * takes precedence within each prefix.
 */
function readOverlayEnv(suffix: string): string | undefined {
  const canonicalKey = `${PROKOPAI_ENV_PREFIX}${suffix}`;
  const overlayCanonical = envOverlay.get(canonicalKey);
  if (overlayCanonical !== undefined) {
    return overlayCanonical;
  }

  const canonicalProcess = process.env[canonicalKey];
  if (canonicalProcess !== undefined) {
    return canonicalProcess;
  }

  const legacyKey = `${JEAN2_ENV_PREFIX}${suffix}`;
  const overlayLegacy = envOverlay.get(legacyKey);
  if (overlayLegacy !== undefined) {
    return overlayLegacy;
  }

  return process.env[legacyKey];
}

export function getDatabasePath(): string | undefined {
  return readEnv('DATABASE_PATH');
}

export function getPort(): number {
  return readEnvInt('PORT', 8742);
}

export function getHost(): string {
  return readEnv('HOST') || '0.0.0.0';
}

export function getToolsPath(): string {
  return readEnv('TOOLS_PATH') || getToolsDir();
}

export function getPreconfigsPath(): string {
  return readEnv('PRECONFIGS_PATH') || getPreconfigsDir();
}

export function getModelsPath(): string | undefined {
  return readEnv('MODELS_PATH');
}

export function getModelsRegistryUrl(): string {
  return (
    readEnv('MODELS_REGISTRY_URL') ||
    'https://raw.githubusercontent.com/capek-dev/prokop/main/packages/server/src/config/models.json'
  );
}

export function getLLMOpenAIApiKey(): string | undefined {
  return readOverlayEnv('LLM_OPENAI_API_KEY');
}

export function getLLMOpenRouterApiKey(): string | undefined {
  return readOverlayEnv('LLM_OPENROUTER_API_KEY');
}

export function getLLMMinimaxApiKey(): string | undefined {
  return readOverlayEnv('LLM_MINIMAX_API_KEY');
}

export function getLLMZhipuApiKey(): string | undefined {
  return readOverlayEnv('LLM_ZHIPU_API_KEY');
}

export function getLLMZhipuCodingApiKey(): string | undefined {
  return readOverlayEnv('LLM_ZHIPU_CODING_API_KEY');
}

export function getLLMDeepseekApiKey(): string | undefined {
  return readOverlayEnv('LLM_DEEPSEEK_API_KEY');
}

export function getLLMBaseUrl(): string | undefined {
  return readEnv('LLM_BASE_URL');
}

export function getLLMTemperature(): number {
  return readEnvFloat('LLM_TEMPERATURE', 0.7);
}

export function getLLMMaxTokens(): number {
  const parsed = readEnvInt('LLM_MAX_TOKENS', 32000);
  return parsed > 0 ? parsed : 32000;
}

export function getLLMMaxSteps(): number {
  const parsed = readEnvInt('LLM_MAX_STEPS', 10);
  return parsed > 0 ? parsed : 10;
}

export function getLLMSubagentMaxSteps(): number {
  const parsed = readEnvInt('LLM_SUBAGENT_MAX_STEPS', 50);
  return parsed > 0 ? parsed : 50;
}

export function getLLMApiKeys(): Record<string, string | undefined> {
  return {
    openai: getLLMOpenAIApiKey(),
    openrouter: getLLMOpenRouterApiKey(),
    minimax: getLLMMinimaxApiKey(),
    zhipu: getLLMZhipuApiKey(),
    'zhipu-coding': getLLMZhipuCodingApiKey(),
    'deepseek': getLLMDeepseekApiKey(),
  };
}

export function hasAnyLLMApiKey(): boolean {
  const keys = getLLMApiKeys();
  return Object.values(keys).some(key => key !== undefined);
}

export function getCompactionModel(): string | undefined {
  return readEnv('COMPACTION_MODEL');
}

export function getCompactionProvider(): string | undefined {
  return readEnv('COMPACTION_PROVIDER');
}

export function getCompactionMaxTokens(): number {
  const parsed = readEnvInt('COMPACTION_MAX_TOKENS', 8000);
  return parsed > 0 ? parsed : 8000;
}

export function getCompactionAutoThresholdRatio(): number {
  const parsed = readEnvFloat('COMPACTION_AUTO_THRESHOLD_RATIO', 0.75);
  return parsed > 0 && parsed < 1 ? parsed : 0.75;
}

export function getCompactionAutoReserveCapTokens(): number {
  const parsed = readEnvInt('COMPACTION_AUTO_RESERVE_CAP_TOKENS', 32000);
  return parsed > 0 ? parsed : 32000;
}

export function getCompactionAutoSafetyMarginTokens(): number {
  const parsed = readEnvInt('COMPACTION_AUTO_SAFETY_MARGIN_TOKENS', 20000);
  return parsed >= 0 ? parsed : 20000;
}

export function getCompactionPreserveRecentToolCount(): number {
  const parsed = readEnvInt('COMPACTION_PRESERVE_RECENT_TOOL_COUNT', 3);
  return parsed >= 0 ? parsed : 3;
}

export function getCompactionPreserveSmallToolChars(): number {
  const parsed = readEnvInt('COMPACTION_PRESERVE_SMALL_TOOL_CHARS', 200);
  return parsed >= 0 ? parsed : 200;
}

export function getCompactionToolClearCharsThreshold(): number {
  const parsed = readEnvInt('COMPACTION_TOOL_CLEAR_CHARS_THRESHOLD', 1000);
  return parsed >= 0 ? parsed : 1000;
}

export function getCompactionMaxPrunedToolCount(): number {
  const parsed = readEnvInt('COMPACTION_MAX_PRUNED_TOOL_COUNT', 50);
  return parsed >= 0 ? parsed : 50;
}

const TOOL_SAFE_ENV_BASE: string[] = [
  // Cross-platform essentials
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'NODE_ENV',
  // Windows-critical variables. These are absent on Unix (no-op), but
  // essential on Windows: without PATHEXT the OS cannot resolve bare
  // executable names like `git` -> `git.exe`, and without SYSTEMROOT many
  // system DLLs / the C runtime fail to load. See getToolEnv().
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
];

export function getToolEnv(allowedEnv?: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const key of TOOL_SAFE_ENV_BASE) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }

  if (allowedEnv) {
    for (const key of allowedEnv) {
      if (process.env[key] !== undefined) {
        env[key] = process.env[key];
      }
    }
  }

  return env;
}

export function getJean2EnvValue(key: string): string | undefined {
  // Canonical resolution: the key as-is (callers pass full canonical
  // PROKOPAI_* keys), falling back to the legacy JEAN2_* twin.
  const overlay = envOverlay.get(key);
  if (overlay !== undefined) {
    return overlay;
  }

  const fromProcess = process.env[key];
  if (fromProcess !== undefined) {
    return fromProcess;
  }

  if (key.startsWith(PROKOPAI_ENV_PREFIX)) {
    const legacyKey = `${JEAN2_ENV_PREFIX}${key.slice(PROKOPAI_ENV_PREFIX.length)}`;
    return envOverlay.get(legacyKey) ?? process.env[legacyKey];
  }

  return undefined;
}

export function getAllJean2EnvKeys(): string[] {
  // Keys as present in the overlay; legacy keys surface with their legacy
  // prefix. Consumers categorize by prefix; tool-env handles both.
  return Array.from(envOverlay.keys());
}

export function reloadJean2Env(): void {
  envOverlay.clear();
  loadEnvFile();
}

export function getClientEnabled(): boolean {
  return readEnv('CLIENT_ENABLED') !== 'false';
}

export function getTlsEnabled(): boolean {
  return readEnv('TLS_ENABLED') === 'true';
}

export function getTlsCertFile(): string | undefined {
  return readEnv('TLS_CERT_FILE');
}

export function getTlsKeyFile(): string | undefined {
  return readEnv('TLS_KEY_FILE');
}

export function getLocalHttpEnabled(): boolean {
  return getTlsEnabled() && readEnv('LOCAL_HTTP') !== 'false';
}

export function getLocalHost(): string {
  return readEnv('LOCAL_HOST') || '127.0.0.1';
}

export function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]';
}

export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.');
}

export function listenersOverlap(host: string, localHost: string): boolean {
  if (isWildcardHost(host)) return true;
  if (host === localHost) return true;
  return isLoopbackHost(host) && isLoopbackHost(localHost);
}

export function resolveTlsPort(host: string, port: number, localHttpEnabled: boolean): number {
  const configured = readEnvInt('TLS_PORT', -1);
  if (configured > 0) {
    return configured;
  }
  if (!localHttpEnabled) {
    return port;
  }
  return listenersOverlap(host, getLocalHost()) ? port + 1 : port;
}

export function getBaseUrl(): string | undefined {
  return readEnv('BASE_URL');
}

export function getPermissionTimeoutMs(): number {
  const parsed = readEnvInt('PERMISSION_TIMEOUT_MS', 1800000);
  return parsed >= 60_000 ? parsed : 1800000;
}
