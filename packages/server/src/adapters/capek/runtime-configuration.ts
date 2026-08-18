import {
  configureRuntimeConfiguration,
  type RuntimeConfiguration,
} from '@capekai/core/internal/configuration';
import {
  findModel,
  findModelVariant,
  getMaxOutputTokens,
  getModelsConfig,
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
  getLLMOpenAIApiKey,
  getLLMOpenRouterApiKey,
  getLLMSubagentMaxSteps,
  getLLMTemperature,
  getLLMZhipuApiKey,
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
  getLLMOpenAIApiKey(): string | undefined;
  getLLMOpenRouterApiKey(): string | undefined;
  getLLMMinimaxApiKey(): string | undefined;
  getLLMZhipuApiKey(): string | undefined;
  getLLMZhipuCodingApiKey(): string | undefined;
  getLLMDeepseekApiKey(): string | undefined;
}

const defaultAccessors: RuntimeConfigurationAccessors = {
  findModel,
  getMaxOutputTokens,
  findModelVariant,
  getModelsConfig,
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
  getLLMOpenAIApiKey,
  getLLMOpenRouterApiKey,
  getLLMMinimaxApiKey,
  getLLMZhipuApiKey,
  getLLMZhipuCodingApiKey,
  getLLMDeepseekApiKey,
};

export function createJean2RuntimeConfiguration(
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
        case 'openai': return accessors.getLLMOpenAIApiKey();
        case 'openrouter': return accessors.getLLMOpenRouterApiKey();
        case 'minimax': return accessors.getLLMMinimaxApiKey();
        case 'zhipu': return accessors.getLLMZhipuApiKey();
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

export const jean2RuntimeConfiguration = createJean2RuntimeConfiguration();

export function configureJean2RuntimeConfiguration(): void {
  configureRuntimeConfiguration(jean2RuntimeConfiguration);
}
