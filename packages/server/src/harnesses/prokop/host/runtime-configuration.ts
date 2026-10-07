import { configureRuntimeConfiguration } from '@/infrastructure/providers/configuration/runtime';
import type { RuntimeConfiguration } from '@/infrastructure/providers/configuration/contracts';
import {
  findModel,
  findModelVariant,
  getMaxOutputTokens,
  getModelsConfig,
  type ModelDefinition,
} from '@/config';
import {
  getCompactionAutoReserveCapTokens,
  getCompactionAutoSafetyMarginTokens,
  getCompactionAutoThresholdRatio,
  getCompactionMaxPrunedToolCount,
  getCompactionMaxTokens,
  getCompactionModel,
  getCompactionPreserveRecentToolCount,
  getCompactionPreserveSmallToolChars,
  getCompactionProvider,
  getCompactionToolClearCharsThreshold,
  getLLMBaseUrl,
  getLLMDeepseekApiKey,
  getLLMMaxSteps,
  getLLMMinimaxApiKey,
  getLLMOpenRouterApiKey,
  getLLMSubagentMaxSteps,
  getLLMTemperature,
  getLLMZhipuCodingApiKey,
} from '@/infrastructure/runtime/environment';

interface RuntimeConfigurationAccessors {
  findModel: RuntimeConfiguration['findModel'];
  getMaxOutputTokens: RuntimeConfiguration['getMaxOutputTokens'];
  findModelVariant: RuntimeConfiguration['findModelVariant'];
  getModelsConfig: RuntimeConfiguration['getModelsConfig'];
  getLLMTemperature: RuntimeConfiguration['getLLMTemperature'];
  getLLMMaxSteps: RuntimeConfiguration['getLLMMaxSteps'];
  getLLMSubagentMaxSteps: RuntimeConfiguration['getLLMSubagentMaxSteps'];
  getLLMBaseUrl: RuntimeConfiguration['getLLMBaseUrl'];
  getCompactionModel: RuntimeConfiguration['getCompactionModel'];
  getCompactionProvider: RuntimeConfiguration['getCompactionProvider'];
  getCompactionMaxTokens: RuntimeConfiguration['getCompactionMaxTokens'];
  getCompactionPreserveRecentToolCount: RuntimeConfiguration['getCompactionPreserveRecentToolCount'];
  getCompactionPreserveSmallToolChars: RuntimeConfiguration['getCompactionPreserveSmallToolChars'];
  getCompactionToolClearCharsThreshold: RuntimeConfiguration['getCompactionToolClearCharsThreshold'];
  getCompactionMaxPrunedToolCount: RuntimeConfiguration['getCompactionMaxPrunedToolCount'];
  getCompactionAutoThresholdRatio: RuntimeConfiguration['getCompactionAutoThresholdRatio'];
  getCompactionAutoReserveCapTokens: RuntimeConfiguration['getCompactionAutoReserveCapTokens'];
  getCompactionAutoSafetyMarginTokens: RuntimeConfiguration['getCompactionAutoSafetyMarginTokens'];
  getLLMOpenRouterApiKey(): string | undefined;
  getLLMMinimaxApiKey(): string | undefined;
  getLLMZhipuCodingApiKey(): string | undefined;
  getLLMDeepseekApiKey(): string | undefined;
}

/**
 * The pinned Capek contract still requires the legacy tier field on models
 * even though the product no longer has tiers (Capek main already dropped
 * it). Serve Capek a defaulted view until the pin moves past that removal.
 */
export function withContractTier<T extends ModelDefinition>(
  model: T,
): T & { tier: 'budget' | 'standard' | 'premium' } {
  return { tier: 'standard', ...model };
}

const defaultAccessors: RuntimeConfigurationAccessors = {
  findModel: (modelId, providerId) => {
    const found = findModel(modelId, providerId);
    return found ? withContractTier(found) : undefined;
  },
  getMaxOutputTokens,
  findModelVariant,
  getModelsConfig: () => {
    const config = getModelsConfig();
    return {
      ...config,
      providers: (config.providers ?? []).map(provider => ({
        ...provider,
        models: provider.models.map(model => withContractTier(model)),
      })),
    };
  },
  getLLMTemperature,
  getLLMMaxSteps,
  getLLMSubagentMaxSteps,
  getLLMBaseUrl,
  getCompactionModel,
  getCompactionProvider,
  getCompactionMaxTokens,
  getCompactionPreserveRecentToolCount,
  getCompactionPreserveSmallToolChars,
  getCompactionToolClearCharsThreshold,
  getCompactionMaxPrunedToolCount,
  getCompactionAutoThresholdRatio,
  getCompactionAutoReserveCapTokens,
  getCompactionAutoSafetyMarginTokens,
  getLLMOpenRouterApiKey,
  getLLMMinimaxApiKey,
  getLLMZhipuCodingApiKey,
  getLLMDeepseekApiKey,
};

export function createProkopRuntimeConfiguration(
  overrides: Partial<RuntimeConfigurationAccessors> = {},
): RuntimeConfiguration {
  const accessors = { ...defaultAccessors, ...overrides };
  return {
    findModel: accessors.findModel,
    getMaxOutputTokens: accessors.getMaxOutputTokens,
    findModelVariant: accessors.findModelVariant,
    getModelsConfig: accessors.getModelsConfig,
    getLLMTemperature: accessors.getLLMTemperature,
    getLLMMaxSteps: accessors.getLLMMaxSteps,
    getLLMSubagentMaxSteps: accessors.getLLMSubagentMaxSteps,
    getLLMBaseUrl: accessors.getLLMBaseUrl,
    getApiKey(providerId) {
      switch (providerId) {
        case 'openrouter': return accessors.getLLMOpenRouterApiKey();
        case 'minimax': return accessors.getLLMMinimaxApiKey();
        case 'zhipu-coding': return accessors.getLLMZhipuCodingApiKey();
        case 'deepseek': return accessors.getLLMDeepseekApiKey();
        default: return undefined;
      }
    },
    getCompactionModel: accessors.getCompactionModel,
    getCompactionProvider: accessors.getCompactionProvider,
    getCompactionMaxTokens: accessors.getCompactionMaxTokens,
    getCompactionPreserveRecentToolCount: accessors.getCompactionPreserveRecentToolCount,
    getCompactionPreserveSmallToolChars: accessors.getCompactionPreserveSmallToolChars,
    getCompactionToolClearCharsThreshold: accessors.getCompactionToolClearCharsThreshold,
    getCompactionMaxPrunedToolCount: accessors.getCompactionMaxPrunedToolCount,
    getCompactionAutoThresholdRatio: accessors.getCompactionAutoThresholdRatio,
    getCompactionAutoReserveCapTokens: accessors.getCompactionAutoReserveCapTokens,
    getCompactionAutoSafetyMarginTokens: accessors.getCompactionAutoSafetyMarginTokens,
  };
}

export const prokopRuntimeConfiguration = createProkopRuntimeConfiguration();

export function configureProkopRuntimeConfiguration(): void {
  configureRuntimeConfiguration(prokopRuntimeConfiguration);
}
