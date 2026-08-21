import { atomicWriteFile, readFileSafe } from './files';
import { getEnvFilePath } from '@/infrastructure/runtime/paths';
import { getJean2EnvValue, getAllJean2EnvKeys, reloadJean2Env } from '@/infrastructure/runtime/environment';
import { listTools } from '@/adapters/capek/contracts';
import { ENV_PRESETS, getPreset, isPresetKey } from './env-presets';
import { ConfigurationPersistenceError, ConfigurationValidationError } from './errors';

function getEnvFilePathForModule(): string {
  return getEnvFilePath();
}

const SENSITIVE_PATTERNS = [
  'API_KEY',
  'SECRET',
  'TOKEN',
  'PASSWORD',
  'PRIVATE_KEY',
  'AUTH',
  'CREDENTIAL',
];

export interface ToolEnvVarStatus {
  key: string;
  configured: boolean;
  sensitive: boolean;
  value?: string;
  description?: string;
  defaultValue?: string;
  example?: string;
  usedBy?: string[];
  source?: 'preset' | 'tool' | 'custom';
  category?: string;
  link?: { label: string; url: string };
}

export interface ToolEnvStatus {
  envVars: ToolEnvVarStatus[];
}

export function isSensitiveEnvKey(key: string): boolean {
  const upperKey = key.toUpperCase();
  return SENSITIVE_PATTERNS.some(pattern => upperKey.includes(pattern));
}

export async function listToolEnvVars(): Promise<ToolEnvStatus> {
  const result = new Map<string, ToolEnvVarStatus>();
  const configuredKeys = new Set(getAllJean2EnvKeys());

  // --- Presets ---
  for (const preset of ENV_PRESETS) {
    const value = getJean2EnvValue(preset.key);
    const configured = value !== undefined && value !== '';
    const status: ToolEnvVarStatus = {
      key: preset.key,
      configured,
      sensitive: preset.sensitive,
      source: 'preset',
      category: preset.category,
      description: preset.description,
      ...(preset.example && { example: preset.example }),
      ...(preset.defaultValue && { defaultValue: preset.defaultValue }),
      ...(preset.link && { link: preset.link }),
    };
    if (configured && !preset.sensitive) {
      status.value = value;
    }
    result.set(preset.key, status);
    configuredKeys.delete(preset.key);
    if (preset.legacyKey) {
      configuredKeys.delete(preset.legacyKey);
    }
  }

  // --- Build exclusion set for keys managed by other surfaces ---
  const excludedKeys = new Set<string>();

  // Prefixed keys (PROKOPAI_* or legacy JEAN2_*): managed by Credentials tab
  // or server config (env.ts getters). Prefixed preset keys (e.g.
  // PROKOPAI_GMAIL_*) are NOT excluded.
  for (const key of configuredKeys) {
    if ((key.startsWith('JEAN2_') || key.startsWith('PROKOPAI_')) && !isPresetKey(key)) {
      excludedKeys.add(key);
    }
  }

  // --- Tool-declared env vars ---
  const tools = await listTools();
  const envVarToolsMap = new Map<string, string[]>();
  for (const tool of tools) {
    if (tool.env && Array.isArray(tool.env)) {
      for (const envVar of tool.env) {
        const existing = envVarToolsMap.get(envVar) || [];
        existing.push(tool.name);
        envVarToolsMap.set(envVar, existing);
        excludedKeys.add(envVar); // also exclude from custom
      }
    }
  }
  for (const [key, usedBy] of envVarToolsMap) {
    if (result.has(key)) continue; // skip if already a preset
    const value = getJean2EnvValue(key);
    const configured = value !== undefined && value !== '';
    const sensitive = isSensitiveEnvKey(key);
    const status: ToolEnvVarStatus = {
      key,
      configured,
      sensitive,
      source: 'tool',
      usedBy,
    };
    if (configured && !sensitive) {
      status.value = value;
    }
    result.set(key, status);
    configuredKeys.delete(key);
  }

  // --- Custom: any remaining configured key not excluded or a preset ---
  for (const key of configuredKeys) {
    if (excludedKeys.has(key)) continue;
    if (result.has(key)) continue;
    const value = getJean2EnvValue(key);
    const configured = value !== undefined && value !== '';
    if (!configured) continue;
    const sensitive = isSensitiveEnvKey(key);
    const status: ToolEnvVarStatus = {
      key,
      configured: true,
      sensitive,
      source: 'custom',
    };
    if (!sensitive) {
      status.value = value;
    }
    result.set(key, status);
  }

  const envVars = Array.from(result.values()).sort((a, b) => a.key.localeCompare(b.key));
  return { envVars };
}

export async function setToolEnvVar(key: string, value: string): Promise<ToolEnvVarStatus> {
  if (!key || typeof key !== 'string' || key.trim() === '') {
    throw new ConfigurationValidationError('Environment variable key must be a non-empty string');
  }

  if (!value || typeof value !== 'string' || value.trim() === '') {
    throw new ConfigurationValidationError('Environment variable value must be a non-empty string');
  }

  const trimmedKey = key.trim();
  const trimmedValue = value.trim();
  const sensitive = isSensitiveEnvKey(trimmedKey);

  try {
    const content = await readFileSafe(getEnvFilePathForModule());
    const lines = content ? content.split('\n') : [];
    let keyFound = false;

    const updatedLines = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return line;
      }

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) {
        return line;
      }

      const existingKey = trimmed.slice(0, eqIndex).trim();
      if (existingKey === trimmedKey) {
        keyFound = true;
        return `${trimmedKey}=${trimmedValue}`;
      }

      return line;
    });

    if (!keyFound) {
      updatedLines.push(`${trimmedKey}=${trimmedValue}`);
    }

    await atomicWriteFile(getEnvFilePathForModule(), updatedLines.join('\n') + '\n');
    reloadJean2Env();

    const preset = getPreset(trimmedKey);
    const status: ToolEnvVarStatus = {
      key: trimmedKey,
      configured: true,
      sensitive: preset ? preset.sensitive : sensitive,
      source: preset ? 'preset' : 'custom',
      ...(preset && { category: preset.category, description: preset.description }),
      ...(preset?.example && { example: preset.example }),
      ...(preset?.link && { link: preset.link }),
    };

    if (!status.sensitive) {
      status.value = trimmedValue;
    }

    return status;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigurationPersistenceError(`Failed to set environment variable ${trimmedKey}: ${message}`);
  }
}

export async function clearToolEnvVar(key: string): Promise<ToolEnvVarStatus> {
  if (!key || typeof key !== 'string' || key.trim() === '') {
    throw new ConfigurationValidationError('Environment variable key must be a non-empty string');
  }

  const trimmedKey = key.trim();
  const preset = getPreset(trimmedKey);
  const sensitive = preset ? preset.sensitive : isSensitiveEnvKey(trimmedKey);

  try {
    const content = await readFileSafe(getEnvFilePathForModule());
    if (!content) {
      reloadJean2Env();
      return {
        key: trimmedKey,
        configured: false,
        sensitive,
        ...(preset && { source: 'preset' as const, category: preset.category, description: preset.description }),
      };
    }

    const lines = content.split('\n');

    const updatedLines = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return true;
      }

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) {
        return true;
      }

      const existingKey = trimmed.slice(0, eqIndex).trim();
      return existingKey !== trimmedKey;
    });

    await atomicWriteFile(getEnvFilePathForModule(), updatedLines.join('\n') + '\n');
    reloadJean2Env();

    return {
      key: trimmedKey,
      configured: false,
      sensitive,
      ...(preset && { source: 'preset' as const, category: preset.category, description: preset.description }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigurationPersistenceError(`Failed to clear environment variable ${trimmedKey}: ${message}`);
  }
}
