import { resolveModelsPath, clearModelsCache, type ModelsConfig, type ModelDefinition } from '@/config';
import { atomicWriteFile } from '@/config/files';
import { existsSync, readFileSync } from 'fs';
import { ConfigurationNotFoundError, ConfigurationValidationError, ConfigurationConflictError } from '@/config/errors';
import { getProkopEnvValue } from '@/infrastructure/runtime/environment';
import { getProviderStatus } from '@/infrastructure/providers/registry';
import type {
  ModelsConfigResponse,
  ModelRuntimeStatus,
  CreateModelRequest,
  UpdateModelRequest,
  SetDefaultsRequest,
  ModelWithStatus,
} from '@prokopai/sdk';

const KNOWN_PROVIDERS = new Set([
  'openrouter', 'minimax', 'zhipu-coding',
  'codex', 'deepseek',
]);

const PROVIDER_ENV_KEYS: Record<string, string> = {
  openrouter: 'PROKOPAI_LLM_OPENROUTER_API_KEY',
  minimax: 'PROKOPAI_LLM_MINIMAX_API_KEY',
  'zhipu-coding': 'PROKOPAI_LLM_ZHIPU_CODING_API_KEY',
  'deepseek': 'PROKOPAI_LLM_DEEPSEEK_API_KEY',
};

export function getModelsDocument(): ModelsConfig {
  const modelsPath = resolveModelsPath();

  if (!existsSync(modelsPath)) {
    throw new ConfigurationNotFoundError('Models configuration', modelsPath);
  }

  let content: string | null;
  try {
    content = readFileSync(modelsPath, 'utf-8');
  } catch {
    throw new ConfigurationNotFoundError('Models configuration', modelsPath);
  }

  let config: unknown;
  try {
    config = JSON.parse(content);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigurationValidationError(`Invalid JSON in models.json: ${message}`);
  }

  if (!validateModelsDocument(config)) {
    throw new ConfigurationValidationError('Invalid models configuration schema');
  }

  return config;
}

export async function saveModelsDocument(config: ModelsConfig): Promise<ModelsConfig> {
  if (!validateModelsDocument(config)) {
    throw new ConfigurationValidationError('Invalid models configuration');
  }

  const modelsPath = resolveModelsPath();
  await atomicWriteFile(modelsPath, JSON.stringify(config, null, 2));
  clearModelsCache();

  return config;
}

export { validateModelsDocument } from './schema';
import { validateModelsDocument } from './schema';

export async function createModel(providerId: string, data: CreateModelRequest): Promise<ModelsConfig> {
  const config = getModelsDocument();

  const provider = config.providers.find(p => p.id === providerId);
  if (!provider) {
    throw new ConfigurationNotFoundError('Provider', providerId);
  }

  const providerModelIds = provider.models.map(m => m.id);
  if (providerModelIds.includes(data.id)) {
    throw new ConfigurationConflictError(`Model with id "${data.id}" already exists in provider "${providerId}"`);
  }

  const newModel: ModelDefinition = {
    id: data.id,
    name: data.name,
    contextWindow: data.contextWindow,
    maxOutputTokens: data.maxOutputTokens,
    variants: data.variants,
    capabilities: data.capabilities,
  };

  provider.models.push(newModel);

  return await saveModelsDocument(config);
}

export async function updateModel(providerId: string, modelId: string, data: UpdateModelRequest): Promise<ModelsConfig> {
  const config = getModelsDocument();

  const provider = config.providers.find(p => p.id === providerId);
  if (!provider) {
    throw new ConfigurationNotFoundError('Provider', providerId);
  }

  const model = provider.models.find(m => m.id === modelId);
  if (!model) {
    throw new ConfigurationNotFoundError('Model', modelId);
  }

  if (data.name !== undefined) {
    model.name = data.name;
  }

  if (data.contextWindow !== undefined) {
    model.contextWindow = data.contextWindow;
  }

  if (data.maxOutputTokens !== undefined) {
    model.maxOutputTokens = data.maxOutputTokens;
  }

  if (data.variants !== undefined) {
    model.variants = data.variants;
  }

  if (data.capabilities !== undefined) {
    model.capabilities = data.capabilities;
  }

  return await saveModelsDocument(config);
}

export async function deleteModel(providerId: string, modelId: string): Promise<ModelsConfig> {
  const config = getModelsDocument();

  const provider = config.providers.find(p => p.id === providerId);
  if (!provider) {
    throw new ConfigurationNotFoundError('Provider', providerId);
  }

  const modelIndex = provider.models.findIndex(m => m.id === modelId);
  if (modelIndex === -1) {
    throw new ConfigurationNotFoundError('Model', modelId);
  }

  if (config.defaultModel === modelId) {
    throw new ConfigurationValidationError(
      `Cannot delete model "${modelId}" because it is set as the default model`,
    );
  }

  provider.models.splice(modelIndex, 1);

  return await saveModelsDocument(config);
}

export async function setDefaults(data: SetDefaultsRequest): Promise<ModelsConfig> {
  const config = getModelsDocument();

  const providerExists = config.providers.some(p => p.id === data.defaultProvider);
  if (!providerExists) {
    throw new ConfigurationValidationError(`Provider "${data.defaultProvider}" does not exist`);
  }

  const defaultProvider = config.providers.find(p => p.id === data.defaultProvider)!;
  const defaultModel = defaultProvider.models.find(m => m.id === data.defaultModel)!;
  const modelExists = defaultProvider.models.some(m => m.id === data.defaultModel);
  if (!modelExists) {
    throw new ConfigurationValidationError(`Model "${data.defaultModel}" does not exist in provider "${data.defaultProvider}"`);
  }

  // The default variant is concrete: a provided value must exist on the
  // default model; omitting it (e.g. a model change) clears back to the
  // model's first (lowest) declared variant.
  if (data.defaultVariant !== undefined && data.defaultVariant !== null) {
    const variantKeys = defaultModel.variants ? Object.keys(defaultModel.variants) : [];
    if (!variantKeys.includes(data.defaultVariant)) {
      throw new ConfigurationValidationError(
        `Variant "${data.defaultVariant}" does not exist on model "${data.defaultModel}"`,
      );
    }
    config.defaultVariant = data.defaultVariant;
  } else {
    config.defaultVariant = null;
  }

  config.defaultProvider = data.defaultProvider;
  config.defaultModel = data.defaultModel;

  return await saveModelsDocument(config);
}

export function getModelRuntimeStatus(providerId: string): ModelRuntimeStatus {
  const providerSupported = KNOWN_PROVIDERS.has(providerId);
  let providerConfigured = false;

  if (providerSupported) {
    const envKey = PROVIDER_ENV_KEYS[providerId];
    if (envKey) {
      providerConfigured = getProkopEnvValue(envKey) !== undefined;
    }

    if (!providerConfigured) {
      const providerStatus = getProviderStatus(providerId);
      providerConfigured = providerStatus.connected;
    }
  }

  const usable = providerSupported && providerConfigured;

  return {
    providerSupported,
    providerConfigured,
    usable,
  };
}

export function getModelsConfigWithStatus(): ModelsConfigResponse {
  const config = getModelsDocument();

  const providersWithStatus: Array<{
    id: string;
    name: string;
    models: ModelWithStatus[];
  }> = config.providers.map(provider => ({
    id: provider.id,
    name: provider.name,
    models: provider.models.map((model): ModelWithStatus => ({
      ...model,
      providerId: provider.id,
      providerName: provider.name,
      runtimeStatus: getModelRuntimeStatus(provider.id),
    })),
  }));

  return {
    providers: providersWithStatus,
    defaultModel: config.defaultModel,
    defaultProvider: config.defaultProvider,
    defaultVariant: config.defaultVariant ?? null,
  };
}
