import type { ModelsConfig, ProviderDefinition } from '@/config';
import { getModelsDocument, saveModelsDocument, validateModelsDocument } from '@/config/models';
import { ConfigurationValidationError } from '@/config/errors';

import { getModelsRegistryUrl } from '@/infrastructure/runtime/environment';

const MODELS_REGISTRY_URL = getModelsRegistryUrl();

export interface SyncResult {
  mode: 'merge' | 'override';
  addedProviders: string[];
  addedModels: string[];
  totalProviders: number;
  totalModels: number;
}

export async function fetchUpstreamModels(): Promise<ModelsConfig> {
  const response = await fetch(MODELS_REGISTRY_URL, {
    headers: {
      'User-Agent': 'jean2-models-sync',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch upstream models: ${response.status} ${response.statusText}`,
    );
  }

  const data: unknown = await response.json();

  if (!validateModelsDocument(data)) {
    throw new ConfigurationValidationError('Upstream models.json failed validation');
  }

  return data;
}

export async function syncModels(mode: 'merge' | 'override'): Promise<SyncResult> {
  const upstream = await fetchUpstreamModels();

  if (mode === 'override') {
    await saveModelsDocument(upstream);

    const totalModels = upstream.providers.reduce(
      (sum, p) => sum + p.models.length,
      0,
    );

    return {
      mode: 'override',
      addedProviders: [],
      addedModels: [],
      totalProviders: upstream.providers.length,
      totalModels,
    };
  }

  const local = getModelsDocument();

  const localProviderIds = new Set(local.providers.map(p => p.id));

  const addedProviders: string[] = [];
  const addedModels: string[] = [];

  for (const upstreamProvider of upstream.providers) {
    if (!localProviderIds.has(upstreamProvider.id)) {
      local.providers.push(structuredClone(upstreamProvider));
      addedProviders.push(upstreamProvider.id);
      for (const m of upstreamProvider.models) {
        addedModels.push(m.id);
      }
      continue;
    }

    const localProvider = local.providers.find(p => p.id === upstreamProvider.id)!;
    mergeProviderModels(localProvider, upstreamProvider, addedModels);
  }

  if (addedProviders.length > 0 || addedModels.length > 0) {
    await saveModelsDocument(local);
  }

  const totalModels = local.providers.reduce(
    (sum, p) => sum + p.models.length,
    0,
  );

  return {
    mode: 'merge',
    addedProviders,
    addedModels,
    totalProviders: local.providers.length,
    totalModels,
  };
}

function mergeProviderModels(
  localProvider: ProviderDefinition,
  upstreamProvider: ProviderDefinition,
  addedModels: string[],
): void {
  const localProviderModelIds = new Set(localProvider.models.map(m => m.id));

  for (const upstreamModel of upstreamProvider.models) {
    if (!localProviderModelIds.has(upstreamModel.id)) {
      localProvider.models.push(structuredClone(upstreamModel));
      localProviderModelIds.add(upstreamModel.id);
      addedModels.push(upstreamModel.id);
    }
  }
}
