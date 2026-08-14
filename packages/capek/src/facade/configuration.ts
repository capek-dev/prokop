import type { RuntimeConfiguration } from '../configuration/contracts';
import { createDefaultRuntimeConfiguration } from '../configuration/defaults';
import { parseModelSpecifier } from '../core/provider-utils';

export interface FacadeModelSelection {
  modelId: string;
  providerId: string;
}

export function resolveFacadeModel(model: string): FacadeModelSelection {
  const parsed = parseModelSpecifier(model);
  return {
    modelId: parsed.modelId,
    providerId: parsed.providerId ?? 'openai',
  };
}

export function createFacadeConfiguration(selection: FacadeModelSelection): RuntimeConfiguration {
  const defaults = createDefaultRuntimeConfiguration();
  return {
    ...defaults,
    findModel(modelId, providerId) {
      const found = defaults.findModel(modelId, providerId);
      if (found) return found;
      if (modelId !== selection.modelId || (providerId && providerId !== selection.providerId)) return undefined;
      return {
        id: selection.modelId,
        name: selection.modelId,
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
        tier: 'standard',
        providerId: selection.providerId,
        providerName: selection.providerId,
      };
    },
    getModelsConfig() {
      const base = defaults.getModelsConfig();
      const providers = base.providers.map((provider) => ({ ...provider, models: [...provider.models] }));
      let provider = providers.find((candidate) => candidate.id === selection.providerId);
      if (!provider) {
        provider = { id: selection.providerId, name: selection.providerId, models: [] };
        providers.push(provider);
      }
      if (!provider.models.some((candidate) => candidate.id === selection.modelId)) {
        provider.models.push({
          id: selection.modelId,
          name: selection.modelId,
          contextWindow: 128_000,
          maxOutputTokens: 16_384,
          tier: 'standard',
        });
      }
      return {
        providers,
        defaultModel: selection.modelId,
        defaultProvider: selection.providerId,
      };
    },
    getApiKey(providerId) {
      const conventional = process.env[`${providerId.toUpperCase().replaceAll('-', '_')}_API_KEY`];
      return conventional ?? defaults.getApiKey(providerId);
    },
  };
}
