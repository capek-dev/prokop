import type { RuntimeConfiguration } from './contracts';
import { createDefaultRuntimeConfiguration } from './defaults';

export interface ModelSpecifierSelection {
  modelId: string;
  providerId: string;
}

/** Splits a `provider/model` string on the first separator; the provider
 * part is kept as-is (matching `parseModelSpecifier` for known provider
 * ids); a bare model gets no provider. Self-contained so the
 * configuration leaf concern stays import-clean. */
export function resolveModelSpecifier(model: string): ModelSpecifierSelection {
  const separator = model.indexOf('/');
  if (separator <= 0 || separator === model.length - 1) {
    return { modelId: model, providerId: 'openai' };
  }
  return {
    providerId: model.slice(0, separator),
    modelId: model.slice(separator + 1),
  };
}

/** A starter `RuntimeConfiguration` for exactly one model string: wraps the
 * package defaults, answers `findModel` for the given selection with a
 * synthetic 128k entry, exposes it through `getModelsConfig`, and resolves
 * API keys from the conventional `<PROVIDER>_API_KEY` env vars. Copy and
 * extend when you outgrow one model. */
export function createSingleModelConfiguration(selection: ModelSpecifierSelection): RuntimeConfiguration {
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
