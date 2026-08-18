import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

import {
  getDatabasePath as getEnvDatabasePath,
  getToolsPath as getEnvToolsPath,
  getPort as getEnvPort,
  getHost as getEnvHost,
  getLLMMaxTokens,
  getModelsPath,
} from '@/infrastructure/runtime/environment';
import {
  getDataDir,
  getConfigPath as getConfigFilePath,
  getModelsConfigPath as getModelsConfigFilePath,
  getDefaultDatabasePath as getDefaultDatabasePathFromPaths,
  getToolsDir,
} from '@/infrastructure/runtime/paths';

// NotInitializedError for when config doesn't exist
export class NotInitializedError extends Error {
  constructor(message = 'Jean2 is not initialized. Run "jean2 init" first.') {
    super(message);
    this.name = 'NotInitializedError';
  }
}

// ModelsConfigNotFoundError for when models.json doesn't exist
export class ModelsConfigNotFoundError extends Error {
  constructor(path?: string) {
    const message = path
      ? `Models configuration not found at ${path}. Run "jean2 init" to create default configuration.`
      : 'Models configuration not found. Run "jean2 init" to create ~/.jean2/models.json';
    super(message);
    this.name = 'ModelsConfigNotFoundError';
  }
}

// ModelsConfigInvalidError for when models.json has invalid schema
export class ModelsConfigInvalidError extends Error {
  constructor(path?: string, details?: string) {
    let message = path
      ? `Invalid models configuration at ${path}`
      : 'Invalid models configuration in ~/.jean2/models.json';
    if (details) {
      message += `: ${details}`;
    }
    super(message);
    this.name = 'ModelsConfigInvalidError';
  }
}

let configCache: { databasePath: string; toolsPath: string; port: number; host: string } | null = null;

let modelsCache: ModelsConfig | null = null;

// Get the models config file path (~/.jean2/models.json)
export function getModelsConfigPath(): string {
  return getModelsConfigFilePath();
}

/**
 * Resolve the models config path using the following priority:
 * 1. JEAN2_MODELS_PATH environment variable (highest priority)
 * 2. Default: ~/.jean2/models.json
 */
export function resolveModelsPath(): string {
  return getModelsPath() || getModelsConfigPath();
}

// Validate models config structure
function validateModelsConfig(config: unknown): config is ModelsConfig {
  if (!config || typeof config !== 'object') {
    return false;
  }
  
  const c = config as Record<string, unknown>;
  
  if (!Array.isArray(c.providers)) {
    return false;
  }
  
  if (typeof c.defaultModel !== 'string') {
    return false;
  }
  
  if (typeof c.defaultProvider !== 'string') {
    return false;
  }
  
  // Validate each provider has required fields
  for (const provider of c.providers) {
    if (!provider || typeof provider !== 'object') {
      return false;
    }
    const p = provider as Record<string, unknown>;
    if (typeof p.id !== 'string' || typeof p.name !== 'string' || !Array.isArray(p.models)) {
      return false;
    }
    
    // Validate each model has required fields
    for (const model of p.models) {
      if (!model || typeof model !== 'object') {
        return false;
      }
      const m = model as Record<string, unknown>;
      if (typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.contextWindow !== 'number') {
        return false;
      }
      if (m.tier !== 'budget' && m.tier !== 'standard' && m.tier !== 'premium') {
        return false;
      }
    }
  }
  
  return true;
}

// Load models config from file (with caching)
function loadModelsConfig(): ModelsConfig {
  if (modelsCache) {
    return modelsCache;
  }
  
  const modelsPath = resolveModelsPath();
  
  if (!existsSync(modelsPath)) {
    throw new ModelsConfigNotFoundError(modelsPath);
  }
  
  try {
    const content = readFileSync(modelsPath, 'utf-8');
    const config = JSON.parse(content);
    
    if (!validateModelsConfig(config)) {
      throw new ModelsConfigInvalidError(modelsPath, 'schema validation failed');
    }
    
    modelsCache = config;
    return modelsCache;
  } catch (err: unknown) {
    if (err instanceof ModelsConfigNotFoundError || err instanceof ModelsConfigInvalidError) {
      throw err;
    }
    // JSON parse error or other file read error
    const message = err instanceof Error ? err.message : String(err);
    throw new ModelsConfigInvalidError(modelsPath, `Failed to parse models.json: ${message}`);
  }
}

function loadConfig(): { databasePath: string; toolsPath: string; port: number; host: string } {
  if (configCache) {
    return configCache;
  }

  const configPath = getConfigFilePath();

  if (!existsSync(configPath)) {
    throw new NotInitializedError();
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    configCache = {
      databasePath: config.databasePath || getDefaultDatabasePathFromPaths(),
      toolsPath: config.toolsPath || getToolsDir(),
      port: config.port || 8742,
      host: config.host || '0.0.0.0',
    };
    return configCache;
  } catch {
    throw new NotInitializedError('Invalid config file. Run "jean2 init" first.');
  }
}

export function isInitialized(): boolean {
  try {
    loadConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the database path using the following priority:
 * 1. JEAN2_DATABASE_PATH environment variable (highest priority)
 * 2. Path from ~/.jean2/config.json
 * 3. Default: ~/.jean2/data/agent.db
 */
export function resolveDatabasePath(): string {
  return getEnvDatabasePath() || loadConfig().databasePath;
}

/**
 * Resolve the tools path using the following priority:
 * 1. JEAN2_TOOLS_PATH environment variable (highest priority)
 * 2. Path from ~/.jean2/config.json
 * 3. Default: ~/.jean2/tools
 */
export function resolveToolsPath(): string {
  return getEnvToolsPath() || loadConfig().toolsPath;
}

// Get port from config (or env override)
export function getPort(): number {
  return getEnvPort();
}

// Get host from config (or env override)
export function getHost(): string {
  return getEnvHost();
}

// Maximum output tokens cap (like opencode's OUTPUT_TOKEN_MAX)
export const OUTPUT_TOKEN_MAX = getLLMMaxTokens();

export interface ModelCapabilities {
  input?: {
    text?: boolean;
    image?: boolean;
    video?: boolean;
    file?: string[];
  };
  /**
   * Structured output handling mode.
   * - `native`: Provider supports `json_schema` response format (OpenAI, DeepSeek, etc.)
   * - `prompt`: Provider strips schema / only supports `json_object`. Schema is injected
   *   into the system prompt and JSON is parsed from text output (GLM, MiniMax)
   * - omitted: same as `native` (default)
   */
  structuredOutput?: {
    mode: 'native' | 'prompt';
  };
}

export interface ModelDefinition {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens?: number;
  tier: 'budget' | 'standard' | 'premium';
  variants?: Record<string, { providerOptions: Record<string, unknown> }>;
  capabilities?: ModelCapabilities;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  models: ModelDefinition[];
}

export interface ModelsConfig {
  providers: ProviderDefinition[];
  defaultModel: string;
  defaultProvider: string;
}

export function getModelsConfig(): ModelsConfig {
  return loadModelsConfig();
}

export function getAllModels(): Array<ModelDefinition & { providerId: string; providerName: string }> {
  const allModels: Array<ModelDefinition & { providerId: string; providerName: string }> = [];
  const modelsConfig = loadModelsConfig();
  
  for (const provider of modelsConfig.providers) {
    for (const model of provider.models) {
      allModels.push({
        ...model,
        providerId: provider.id,
        providerName: provider.name,
      } as ModelDefinition & { providerId: string; providerName: string });
    }
  }
  
  return allModels;
}

export function findModel(modelId: string, providerId?: string): (ModelDefinition & { providerId: string; providerName: string }) | undefined {
  if (providerId) {
    const config = loadModelsConfig();
    const provider = config.providers.find(p => p.id === providerId);
    if (!provider) return undefined;
    const model = provider.models.find(m => m.id === modelId);
    if (!model) return undefined;
    return {
      ...model,
      providerId: provider.id,
      providerName: provider.name,
    } as ModelDefinition & { providerId: string; providerName: string };
  }
  return getAllModels().find(m => m.id === modelId);
}

export function findModelVariant(
  modelId: string,
  variantKey: string,
  providerId?: string,
): Record<string, unknown> | undefined {
  const model = findModel(modelId, providerId);
  return model?.variants?.[variantKey]?.providerOptions;
}

/**
 * Get the effective max output tokens for a model.
 * Uses the minimum of the model's limit and OUTPUT_TOKEN_MAX (32000 by default).
 * Falls back to OUTPUT_TOKEN_MAX if model info is unavailable.
 */
export function getMaxOutputTokens(modelId?: string): number {
  if (!modelId) {
    return OUTPUT_TOKEN_MAX;
  }
  
  const model = findModel(modelId);
  
  if (!model || !model.maxOutputTokens) {
    return OUTPUT_TOKEN_MAX;
  }
  
  return Math.min(model.maxOutputTokens, OUTPUT_TOKEN_MAX);
}

// Get the config directory path (~/.jean2)
export function getConfigDir(): string {
  return getDataDir();
}

// Get the config file path (~/.jean2/config.json)
export function getConfigPath(): string {
  return getConfigFilePath();
}

// Get the default database path (~/.jean2/data/agent.db)
export function getDefaultDatabasePath(): string {
  return getDefaultDatabasePathFromPaths();
}

// Get the default tools path (~/.jean2/tools)
export function getDefaultToolsPath(): string {
  return getToolsDir();
}

// Config interface for init
export interface Jean2Config {
  databasePath: string;
  toolsPath: string;
  port: number;
  host: string;
  initializedAt: string;
}

// Save the config (creates directory if needed)
export function saveConfig(config: Jean2Config): void {
  const configDir = getConfigDir();
  mkdirSync(configDir, { recursive: true });
  writeFileSync(getConfigFilePath(), JSON.stringify(config, null, 2));
}

// Clear the config cache (needed when re-initializing)
export function clearConfigCache(): void {
  configCache = null;
}

// Clear the models cache (needed when re-initializing)
export function clearModelsCache(): void {
  modelsCache = null;
}
